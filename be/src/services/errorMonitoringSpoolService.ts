import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DEFAULT_SEGMENT_BYTES = 1024 * 1024;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const MIN_SEGMENT_BYTES = 64 * 1024;
const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
const MIN_MAX_BYTES = 64 * 1024;
const MAX_MAX_BYTES = 512 * 1024 * 1024;
const MAX_RECORD_BYTES = 512 * 1024;
const DEFAULT_MAX_RECORDS_PER_SEGMENT = 2_000;
const MIN_MAX_RECORDS_PER_SEGMENT = 100;
const MAX_MAX_RECORDS_PER_SEGMENT = 50_000;
const DEFAULT_STALE_CLAIM_MS = 10 * 60_000;
const MIN_STALE_CLAIM_MS = 60_000;
const MAX_STALE_CLAIM_MS = 24 * 60 * 60_000;
const RECORD_COUNT_RESCAN_MS = 30_000;

type SpoolEnvelope<T> = {
  version: 1;
  id: string;
  queuedAt: string;
  event: T;
};

export type ErrorMonitoringSpoolOptions = {
  filePath: string;
  segmentBytes?: number;
  maxBytes?: number;
  maxRecordsPerSegment?: number;
  /** Stable only for this process lifetime; defaults to PM2 instance + pid + UUID. */
  writerId?: string;
  staleClaimMs?: number;
  onDiagnostic?: (message: string) => void;
};

export type ErrorMonitoringSpoolAppendOptions = {
  /** Flushes the file descriptor before returning. Intended only for fatal events. */
  durable?: boolean;
};

export type ErrorMonitoringSpoolReplayResult = {
  files: number;
  records: number;
  persisted: number;
  retained: number;
  malformed: number;
  fileErrors: number;
};

export type ErrorMonitoringSpoolStats = {
  files: number;
  bytes: number;
  records: number;
  evictedRecords: number;
  evictedBytes: number;
};

const clampInteger = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.floor(value as number), max));
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const parseEnvelope = <T extends object>(line: string): SpoolEnvelope<T> | null => {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isPlainRecord(parsed)
      || parsed.version !== 1
      || typeof parsed.id !== 'string'
      || typeof parsed.queuedAt !== 'string'
      || !isPlainRecord(parsed.event)) {
      return null;
    }
    return parsed as SpoolEnvelope<T>;
  } catch {
    return null;
  }
};

/**
 * A small append-only emergency queue. It deliberately has no dependency on
 * Sequelize or the application logger so a monitoring failure cannot recurse.
 */
export class ErrorMonitoringDiskSpool<T extends object> {
  private readonly filePath: string;

  private readonly activeFilePath: string;

  private readonly directory: string;

  private readonly baseName: string;

  private readonly segmentBytes: number;

  private readonly maxBytes: number;

  private readonly segmentCount: number;

  private readonly maxRecordsPerSegment: number;

  private readonly writerId: string;

  private readonly staleClaimMs: number;

  private readonly onDiagnostic?: (message: string) => void;

  private replayPromise: Promise<ErrorMonitoringSpoolReplayResult> | null = null;

  private knownActiveBytes = -1;

  private knownActiveRecords = 0;

  private evictedRecords = 0;

  private evictedBytes = 0;

  private queuedRecordCount: number | null = null;

  private queuedRecordBytesSnapshot = 0;

  private lastRecordCountScanAt = 0;

  constructor(options: ErrorMonitoringSpoolOptions) {
    this.filePath = path.resolve(options.filePath);
    this.directory = path.dirname(this.filePath);
    this.baseName = path.basename(this.filePath);
    const configuredWriter = options.writerId
      ?? `${process.env.NODE_APP_INSTANCE ?? 'instance'}-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.writerId = configuredWriter.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || `pid-${process.pid}`;
    this.activeFilePath = `${this.filePath}.${this.writerId}.active`;
    this.segmentBytes = clampInteger(
      options.segmentBytes,
      DEFAULT_SEGMENT_BYTES,
      MIN_SEGMENT_BYTES,
      MAX_SEGMENT_BYTES,
    );
    this.maxBytes = Math.max(
      this.segmentBytes,
      clampInteger(options.maxBytes, DEFAULT_MAX_BYTES, MIN_MAX_BYTES, MAX_MAX_BYTES),
    );
    this.segmentCount = Math.max(1, Math.floor(this.maxBytes / this.segmentBytes));
    this.maxRecordsPerSegment = clampInteger(
      options.maxRecordsPerSegment,
      DEFAULT_MAX_RECORDS_PER_SEGMENT,
      MIN_MAX_RECORDS_PER_SEGMENT,
      MAX_MAX_RECORDS_PER_SEGMENT,
    );
    this.staleClaimMs = clampInteger(
      options.staleClaimMs,
      DEFAULT_STALE_CLAIM_MS,
      MIN_STALE_CLAIM_MS,
      MAX_STALE_CLAIM_MS,
    );
    this.onDiagnostic = options.onDiagnostic;
  }

  append(event: T, options: ErrorMonitoringSpoolAppendOptions = {}): boolean {
    const envelope: SpoolEnvelope<T> = {
      version: 1,
      id: randomUUID(),
      queuedAt: new Date().toISOString(),
      event,
    };
    return this.appendSerialized(JSON.stringify(envelope), options.durable === true);
  }

  replay(handler: (event: T) => Promise<unknown>): Promise<ErrorMonitoringSpoolReplayResult> {
    if (this.replayPromise) return this.replayPromise;
    this.replayPromise = this.performReplay(handler).finally(() => {
      this.replayPromise = null;
    });
    return this.replayPromise;
  }

  getStats(): ErrorMonitoringSpoolStats {
    try {
      if (!existsSync(this.directory)) {
        this.queuedRecordCount = 0;
        this.queuedRecordBytesSnapshot = 0;
        return {
          files: 0,
          bytes: 0,
          records: 0,
          evictedRecords: this.evictedRecords,
          evictedBytes: this.evictedBytes,
        };
      }
      const candidates = this.listCandidatePaths();
      const aggregate = candidates.reduce<{ files: number; bytes: number }>((total, candidate) => {
        try {
          return { files: total.files + 1, bytes: total.bytes + statSync(candidate).size };
        } catch {
          return total;
        }
      }, { files: 0, bytes: 0 });
      const now = Date.now();
      const shouldRescanRecords = this.queuedRecordCount == null
        || (aggregate.bytes !== this.queuedRecordBytesSnapshot
          && now - this.lastRecordCountScanAt >= RECORD_COUNT_RESCAN_MS);
      if (shouldRescanRecords) {
        this.queuedRecordCount = candidates.reduce((total, candidate) => {
          try {
            return total + readFileSync(candidate, 'utf8')
              .split(/\r?\n/)
              .filter((line) => line.trim()).length;
          } catch {
            return total;
          }
        }, 0);
        this.queuedRecordBytesSnapshot = aggregate.bytes;
        this.lastRecordCountScanAt = now;
      }
      return {
        files: aggregate.files,
        bytes: aggregate.bytes,
        records: this.queuedRecordCount ?? 0,
        evictedRecords: this.evictedRecords,
        evictedBytes: this.evictedBytes,
      };
    } catch {
      return {
        files: 0,
        bytes: 0,
        records: 0,
        evictedRecords: this.evictedRecords,
        evictedBytes: this.evictedBytes,
      };
    }
  }

  private diagnostic(message: string): void {
    try {
      this.onDiagnostic?.(message.slice(0, 500));
    } catch {
      // A diagnostic callback must not interfere with emergency persistence.
    }
  }

  private segmentPath(index: number): string {
    return index === 0 ? this.activeFilePath : `${this.filePath}.${this.writerId}.${index}`;
  }

  private isCandidateName(name: string): boolean {
    const escaped = this.escapeRegExp(this.baseName);
    if (name === this.baseName) return true;
    if (new RegExp(`^${escaped}\\.\\d+$`).test(name)) return true;
    if (new RegExp(`^${escaped}\\.[A-Za-z0-9_-]+\\.(?:active|\\d+)$`).test(name)) return true;
    return name.startsWith(`${this.baseName}.processing.`)
      || name.startsWith(`${this.baseName}.processing-`);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isOwnedCandidate(candidate: string): boolean {
    const name = path.basename(candidate);
    return name.startsWith(`${this.baseName}.${this.writerId}.`)
      || name.startsWith(`${this.baseName}.processing.${this.writerId}.`);
  }

  private isLegacyCandidate(candidate: string): boolean {
    const name = path.basename(candidate);
    return name === this.baseName
      || new RegExp(`^${this.escapeRegExp(this.baseName)}\\.\\d+$`).test(name);
  }

  private listCandidatePaths(forReplay = false): string[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => this.isCandidateName(name))
      .map((name) => path.join(this.directory, name))
      .filter((candidate) => {
        if (!forReplay || this.isOwnedCandidate(candidate) || this.isLegacyCandidate(candidate)) return true;
        try {
          return Date.now() - statSync(candidate).mtimeMs >= this.staleClaimMs;
        } catch {
          return false;
        }
      })
      .sort((left, right) => {
        try {
          return statSync(left).mtimeMs - statSync(right).mtimeMs;
        } catch {
          return left.localeCompare(right);
        }
      });
  }

  private refreshActiveState(): void {
    if (!existsSync(this.activeFilePath)) {
      if (this.knownActiveBytes > 0) this.queuedRecordCount = null;
      this.knownActiveBytes = 0;
      this.knownActiveRecords = 0;
      return;
    }
    const currentBytes = statSync(this.activeFilePath).size;
    if (currentBytes === this.knownActiveBytes) return;
    if (this.knownActiveBytes >= 0) this.queuedRecordCount = null;
    const raw = readFileSync(this.activeFilePath, 'utf8');
    this.knownActiveBytes = currentBytes;
    this.knownActiveRecords = raw.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  private rotateIfNeeded(nextBytes: number): void {
    this.refreshActiveState();
    if (this.knownActiveBytes === 0
      || (this.knownActiveBytes + nextBytes <= this.segmentBytes
        && this.knownActiveRecords < this.maxRecordsPerSegment)) return;

    if (this.segmentCount === 1) {
      this.recordEviction(this.activeFilePath);
      unlinkSync(this.activeFilePath);
      this.knownActiveBytes = 0;
      this.knownActiveRecords = 0;
      return;
    }

    const oldest = this.segmentPath(this.segmentCount - 1);
    if (existsSync(oldest)) {
      this.recordEviction(oldest);
      unlinkSync(oldest);
    }
    for (let index = this.segmentCount - 2; index >= 1; index -= 1) {
      const source = this.segmentPath(index);
      if (!existsSync(source)) continue;
      renameSync(source, this.segmentPath(index + 1));
    }
    renameSync(this.activeFilePath, this.segmentPath(1));
    this.knownActiveBytes = 0;
    this.knownActiveRecords = 0;
  }

  private recordEviction(candidate: string): void {
    try {
      const raw = readFileSync(candidate, 'utf8');
      const bytes = Buffer.byteLength(raw, 'utf8');
      const records = raw.split(/\r?\n/).filter((line) => line.trim()).length;
      this.evictedBytes += bytes;
      this.evictedRecords += records;
      if (this.queuedRecordCount != null) {
        this.queuedRecordCount = Math.max(0, this.queuedRecordCount - records);
        this.queuedRecordBytesSnapshot = Math.max(0, this.queuedRecordBytesSnapshot - bytes);
      }
      this.diagnostic(`spool capacity evicted records=${records} bytes=${bytes}`);
    } catch {
      // The exact count is unknowable, but surface at least one lost record.
      this.evictedRecords += 1;
      this.diagnostic('spool capacity evicted an unreadable segment');
    }
  }

  private appendSerialized(serialized: string, durable: boolean): boolean {
    const line = `${serialized}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > Math.min(this.segmentBytes, MAX_RECORD_BYTES)) {
      this.diagnostic(`spool record exceeds the ${Math.min(this.segmentBytes, MAX_RECORD_BYTES)} byte limit`);
      return false;
    }
    try {
      mkdirSync(this.directory, { recursive: true });
      this.rotateIfNeeded(bytes);
      if (durable) {
        const descriptor = openSync(this.activeFilePath, 'a', 0o600);
        try {
          writeSync(descriptor, line, undefined, 'utf8');
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      } else {
        appendFileSync(this.activeFilePath, line, { encoding: 'utf8', mode: 0o600 });
      }
      chmodSync(this.activeFilePath, 0o600);
      this.knownActiveBytes = Math.max(0, this.knownActiveBytes) + bytes;
      this.knownActiveRecords += 1;
      if (this.queuedRecordCount != null) {
        this.queuedRecordCount += 1;
        this.queuedRecordBytesSnapshot += bytes;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diagnostic(`spool append failed: ${message}`);
      return false;
    }
  }

  private claim(candidate: string): string | null {
    const candidateName = path.basename(candidate);
    if ((candidateName.startsWith(`${this.baseName}.processing.`)
      || candidateName.startsWith(`${this.baseName}.processing-`))
      && this.isOwnedCandidate(candidate)) return candidate;
    const claimed = `${this.filePath}.processing.${this.writerId}.${randomUUID()}`;
    try {
      renameSync(candidate, claimed);
      if (candidate === this.activeFilePath) {
        this.knownActiveBytes = 0;
        this.knownActiveRecords = 0;
      }
      return claimed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diagnostic(`spool claim failed: ${message}`);
      return null;
    }
  }

  private async performReplay(
    handler: (event: T) => Promise<unknown>,
  ): Promise<ErrorMonitoringSpoolReplayResult> {
    const result: ErrorMonitoringSpoolReplayResult = {
      files: 0,
      records: 0,
      persisted: 0,
      retained: 0,
      malformed: 0,
      fileErrors: 0,
    };

    let candidates: string[];
    try {
      candidates = this.listCandidatePaths(true);
    } catch (error) {
      result.fileErrors += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.diagnostic(`spool listing failed: ${message}`);
      return result;
    }

    for (const candidate of candidates) {
      const claimed = this.claim(candidate);
      if (!claimed) {
        result.fileErrors += 1;
        continue;
      }
      result.files += 1;

      let raw: string;
      try {
        const size = statSync(claimed).size;
        if (size > Math.max(this.segmentBytes, MAX_RECORD_BYTES) * 2) {
          result.malformed += 1;
          this.diagnostic(`oversized spool segment skipped: ${path.basename(claimed)}`);
          unlinkSync(claimed);
          this.queuedRecordCount = null;
          continue;
        }
        raw = readFileSync(claimed, 'utf8');
      } catch (error) {
        result.fileErrors += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.diagnostic(`spool read failed: ${message}`);
        continue;
      }

      const storedLines = raw.split(/\r?\n/).filter((line) => line.trim());
      const envelopes: SpoolEnvelope<T>[] = [];
      for (const line of storedLines) {
        const envelope = parseEnvelope<T>(line);
        if (!envelope) {
          result.malformed += 1;
          continue;
        }
        envelopes.push(envelope);
      }
      result.records += envelopes.length;

      let failedAt = -1;
      for (let index = 0; index < envelopes.length; index += 1) {
        try {
          await handler(envelopes[index].event);
          result.persisted += 1;
        } catch (error) {
          failedAt = index;
          const message = error instanceof Error ? error.message : String(error);
          this.diagnostic(`spool replay paused after persistence failure: ${message}`);
          break;
        }
      }

      let retainedSafely = true;
      if (failedAt >= 0) {
        const remaining = envelopes.slice(failedAt);
        result.retained += remaining.length;
        for (const envelope of remaining) {
          if (!this.appendSerialized(JSON.stringify(envelope), false)) {
            retainedSafely = false;
            result.fileErrors += 1;
            break;
          }
        }
      }

      if (retainedSafely) {
        try {
          unlinkSync(claimed);
          if (this.queuedRecordCount != null) {
            this.queuedRecordCount = Math.max(0, this.queuedRecordCount - storedLines.length);
            this.queuedRecordBytesSnapshot = Math.max(
              0,
              this.queuedRecordBytesSnapshot - Buffer.byteLength(raw, 'utf8'),
            );
          }
        } catch (error) {
          result.fileErrors += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.diagnostic(`spool cleanup failed: ${message}`);
        }
      }

      // A failed database write usually means the database is unavailable. Do
      // not churn every segment; retry from this point on the next interval.
      if (failedAt >= 0 || !retainedSafely) break;
    }

    return result;
  }
}

export const parseErrorMonitoringSpoolBytes = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = Number(value);
  return clampInteger(parsed, fallback, min, max);
};

export const resolveErrorMonitoringSpoolOptions = (): ErrorMonitoringSpoolOptions => {
  const segmentBytes = parseErrorMonitoringSpoolBytes(
    process.env.ERROR_MONITORING_SPOOL_SEGMENT_BYTES,
    DEFAULT_SEGMENT_BYTES,
    MIN_SEGMENT_BYTES,
    MAX_SEGMENT_BYTES,
  );
  const maxBytes = parseErrorMonitoringSpoolBytes(
    process.env.ERROR_MONITORING_SPOOL_MAX_BYTES,
    DEFAULT_MAX_BYTES,
    Math.max(MIN_MAX_BYTES, segmentBytes),
    MAX_MAX_BYTES,
  );
  return {
    filePath: process.env.ERROR_MONITORING_SPOOL_PATH?.trim()
      || path.join(process.cwd(), 'runtime', 'error-monitoring', 'failed-events.ndjson'),
    segmentBytes,
    maxBytes,
    maxRecordsPerSegment: parseErrorMonitoringSpoolBytes(
      process.env.ERROR_MONITORING_SPOOL_MAX_RECORDS_PER_SEGMENT,
      DEFAULT_MAX_RECORDS_PER_SEGMENT,
      MIN_MAX_RECORDS_PER_SEGMENT,
      MAX_MAX_RECORDS_PER_SEGMENT,
    ),
  };
};
