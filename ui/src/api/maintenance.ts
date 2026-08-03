import { useQuery } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type ConfigSeedRun = {
  id: number;
  seedKey: string;
  runType: string;
  seededBy: number | null;
  seededCount: number;
  seedDetails: { keys?: string[] } | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationAuditRun = {
  runId: string;
  direction: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  nodeEnv: string | null;
  dbName: string | null;
  errorMessage: string | null;
  stepCount: number;
  failedSteps: number;
  successSteps: number;
  runningSteps: number;
};

export const useConfigSeedRuns = (limit = 5) =>
  useQuery<ConfigSeedRun[], unknown>({
    queryKey: ["config-seed-runs", limit],
    queryFn: async () => {
      const response = await axiosInstance.get(`/config/seed/runs?limit=${limit}`);
      return (response.data?.runs ?? []) as ConfigSeedRun[];
    },
  });

export const useMigrationAuditRuns = (limit = 5) =>
  useQuery<MigrationAuditRun[], unknown>({
    queryKey: ["migration-audit-runs", limit],
    queryFn: async () => {
      const response = await axiosInstance.get(`/migrations/audit?limit=${limit}`);
      return (response.data?.runs ?? []) as MigrationAuditRun[];
    },
  });

export type MaintenanceCommandAction = 'git-pull' | 'migrate-prod' | 'sync-access-control-prod';

export type MaintenanceCommandResult = {
  action: MaintenanceCommandAction;
  status: 'success' | 'failed';
  exitCode: number | null;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
};

type MaintenanceCommandJob = {
  id: string;
  action: MaintenanceCommandAction;
  status: 'running' | 'success' | 'failed';
  result: MaintenanceCommandResult | null;
  error: string | null;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export const runMaintenanceCommand = async (
  action: MaintenanceCommandAction,
): Promise<MaintenanceCommandResult> => {
  const response = await axiosInstance.post<{ job: MaintenanceCommandJob }>('/maintenance/commands', { action });
  const jobId = response.data.job.id;

  // The command runs at the origin. Polling keeps every HTTP request short so
  // neither the local reverse proxy nor Cloudflare has to hold a migration
  // connection open for its entire duration.
  for (;;) {
    await wait(2000);
    try {
      const statusResponse = await axiosInstance.get<{ job: MaintenanceCommandJob }>(
        `/maintenance/commands/${jobId}`,
      );
      const job = statusResponse.data.job;
      if (job.status === 'success' && job.result) {
        return job.result;
      }
      if (job.status === 'failed') {
        if (job.result) {
          return job.result;
        }
        throw new Error(job.error ?? 'Maintenance command failed');
      }
    } catch (error: any) {
      // A deploy/restart can briefly make polling unavailable. Keep retrying
      // network and 5xx failures; surface durable client/authorization errors.
      const status = error?.response?.status as number | undefined;
      if (status != null && status < 500) {
        throw error;
      }
    }
  }
};
