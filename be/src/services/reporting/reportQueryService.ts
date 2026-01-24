import crypto from "crypto";
import { Op } from "sequelize";
import ReportQueryCacheEntry from "../../models/ReportQueryCacheEntry.js";
import ReportAsyncJob from "../../models/ReportAsyncJob.js";
import { getConfigValue } from "../configService.js";

export type QueryExecutionResult = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sql: string;
  meta: Record<string, unknown>;
};

type AsyncJobHandler = () => Promise<QueryExecutionResult>;

const resolveCacheTtlSeconds = (): number => Number(getConfigValue("REPORT_CACHE_TTL_SECONDS") ?? 300);
const jobQueue: Array<{ job: ReportAsyncJob; execute: AsyncJobHandler; hash: string; ttlSeconds: number; templateId?: string | null }> = [];
let processing = false;

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet();
  const stringify = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") {
      return input;
    }
    if (seen.has(input as object)) {
      return null;
    }
    seen.add(input as object);
    if (Array.isArray(input)) {
      return input.map((item) => stringify(item));
    }
    const entries = Object.entries(input as Record<string, unknown>)
      .map(([key, val]) => [key, stringify(val)] as [string, unknown])
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = val;
      return acc;
    }, {});
  };

  return JSON.stringify(stringify(value));
};

export const computeQueryHash = (config: unknown): string => {
  const canonical = stableStringify(config);
  return crypto.createHash("sha256").update(canonical).digest("hex");
};

export const getCachedQueryResult = async (
  hash: string,
): Promise<QueryExecutionResult | null> => {
  const entry = await ReportQueryCacheEntry.findOne({
    where: {
      hash,
      expiresAt: {
        [Op.gt]: new Date(),
      },
    },
  });
  if (!entry) {
    return null;
  }
  const cachedResult = (entry.result ?? {}) as Partial<QueryExecutionResult> & {
    rows?: unknown;
    columns?: unknown;
    sql?: unknown;
  };
  const cachedMeta =
    entry.meta && typeof entry.meta === "object" ? (entry.meta as Record<string, unknown>) : {};
  return {
    rows: Array.isArray(cachedResult.rows)
      ? (cachedResult.rows as Array<Record<string, unknown>>)
      : [],
    columns: Array.isArray(cachedResult.columns) ? (cachedResult.columns as string[]) : [],
    sql: typeof cachedResult.sql === "string" ? cachedResult.sql : "",
    meta: {
      ...cachedMeta,
      cached: true,
      cachedAt: entry.createdAt?.toISOString() ?? new Date().toISOString(),
    },
  };
};

export const storeQueryCacheEntry = async (
  hash: string,
  templateId: string | null | undefined,
  payload: QueryExecutionResult,
  ttlSeconds?: number,
): Promise<void> => {
  const resolvedTtlSeconds = ttlSeconds ?? resolveCacheTtlSeconds();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + resolvedTtlSeconds * 1000);
  await ReportQueryCacheEntry.upsert({
    hash,
    templateId: templateId ?? null,
    result: {
      rows: payload.rows,
      columns: payload.columns,
      sql: payload.sql,
    },
    meta: payload.meta,
    createdAt,
    expiresAt,
  });
};

const processQueue = async () => {
  if (processing || jobQueue.length === 0) {
    return;
  }
  processing = true;

  while (jobQueue.length > 0) {
    const item = jobQueue.shift();
    if (!item) {
      continue;
    }
    const { job, execute, hash, ttlSeconds, templateId } = item;
    try {
      job.status = "running";
      job.startedAt = new Date();
      await job.save();

      const result = await execute();
      await storeQueryCacheEntry(hash, templateId ?? null, result, ttlSeconds);

      job.status = "completed";
      job.result = result;
      job.finishedAt = new Date();
      job.updatedAt = new Date();
      await job.save();
    } catch (error) {
      job.status = "failed";
      job.error = { message: error instanceof Error ? error.message : "Unknown error" };
      job.finishedAt = new Date();
      job.updatedAt = new Date();
      await job.save();
    }
  }

  processing = false;
};

export const enqueueQueryJob = async (
  hash: string,
  templateId: string | null | undefined,
  handler: AsyncJobHandler,
  ttlSeconds?: number,
): Promise<ReportAsyncJob> => {
  const resolvedTtlSeconds = ttlSeconds ?? resolveCacheTtlSeconds();
  const job = await ReportAsyncJob.create({
    hash,
    status: "queued",
    payload: { hash, templateId },
  });

  jobQueue.push({
    job,
    execute: handler,
    hash,
    ttlSeconds: resolvedTtlSeconds,
    templateId: templateId ?? null,
  });

  void processQueue();

  return job;
};

export const getAsyncJobStatus = async (jobId: string): Promise<ReportAsyncJob | null> => {
  return ReportAsyncJob.findByPk(jobId);
};
