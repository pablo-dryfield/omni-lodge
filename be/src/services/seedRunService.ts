import ConfigSeedRun from '../models/ConfigSeedRun.js';

export type SeedRunRecord = {
  seedKey: string;
  runType: string;
  seededBy?: number | null;
  seededCount: number;
  seedDetails?: Record<string, unknown> | null;
};

export type SeedExecutionResult = {
  seededCount: number;
  details?: Record<string, unknown> | null;
};

export const hasSeedRun = async (seedKey: string, runType?: string): Promise<boolean> => {
  const count = await ConfigSeedRun.count({
    where: runType ? { seedKey, runType } : { seedKey },
  });
  return count > 0;
};

export const recordSeedRun = async (record: SeedRunRecord): Promise<void> => {
  await ConfigSeedRun.create({
    seedKey: record.seedKey,
    runType: record.runType,
    seededBy: record.seededBy ?? null,
    seededCount: record.seededCount,
    seedDetails: record.seedDetails ?? null,
  });
};

export const runSeedOnce = async (params: {
  seedKey: string;
  runType: string;
  actorId?: number | null;
  run: () => Promise<SeedExecutionResult> | SeedExecutionResult;
}): Promise<{ skipped: boolean; seededCount: number; details?: Record<string, unknown> | null }> => {
  const { seedKey, runType, actorId, run } = params;
  if (await hasSeedRun(seedKey)) {
    return { skipped: true, seededCount: 0 };
  }

  const result = await Promise.resolve(run());
  await recordSeedRun({
    seedKey,
    runType,
    seededBy: actorId ?? null,
    seededCount: result.seededCount,
    seedDetails: result.details ?? null,
  });

  return { skipped: false, seededCount: result.seededCount, details: result.details ?? null };
};

export const listSeedRuns = async (limit = 5): Promise<ConfigSeedRun[]> => {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  return ConfigSeedRun.findAll({
    order: [['created_at', 'DESC']],
    limit: safeLimit,
  });
};
