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

export const runMaintenanceCommand = async (
  action: MaintenanceCommandAction,
): Promise<MaintenanceCommandResult> => {
  const response = await axiosInstance.post('/maintenance/commands', { action });
  return response.data?.result as MaintenanceCommandResult;
};
