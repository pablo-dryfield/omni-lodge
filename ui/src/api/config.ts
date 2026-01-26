import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type ConfigEntry = {
  key: string;
  label: string;
  description: string | null;
  category: string;
  valueType: string;
  defaultValue: string | null;
  validationRules: Record<string, unknown> | null;
  isSecret: boolean;
  isEditable: boolean;
  impact: string;
  value: string | null;
  maskedValue: string | null;
  isSet: boolean;
  updatedAt: string | null;
  updatedBy: number | null;
};

export type ConfigHistoryEntry = {
  id: number;
  key: string;
  actorId: number | null;
  oldValue: string | null;
  newValue: string | null;
  isSecret: boolean;
  reason: string | null;
  createdAt: string;
};

const CONFIG_QUERY_KEY = ["config-entries"];

export const useConfigEntries = () =>
  useQuery<ConfigEntry[], unknown>({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => {
      const response = await axiosInstance.get("/config");
      return (response.data?.configs ?? []) as ConfigEntry[];
    },
  });

export const useConfigEntry = (key: string | null) =>
  useQuery<ConfigEntry | null, unknown>({
    queryKey: ["config-entry", key],
    queryFn: async () => {
      if (!key) {
        return null;
      }
      const response = await axiosInstance.get(`/config/${encodeURIComponent(key)}`);
      return (response.data?.config ?? null) as ConfigEntry | null;
    },
    enabled: Boolean(key),
  });

export const useUpdateConfigEntry = () => {
  const queryClient = useQueryClient();

  return useMutation<
    ConfigEntry,
    unknown,
    { key: string; value: unknown; password?: string; reason?: string | null }
  >({
    mutationFn: async ({ key, value, password, reason }) => {
      const response = await axiosInstance.post(`/config/${encodeURIComponent(key)}`, {
        value,
        password,
        reason,
      });
      return response.data?.config as ConfigEntry;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });
};

export const revealConfigSecret = async (
  key: string,
  password: string,
): Promise<{ value: string | null }> => {
  const response = await axiosInstance.post(`/config/${encodeURIComponent(key)}/reveal`, { password });
  return response.data as { value: string | null };
};

export const fetchConfigHistory = async (key: string): Promise<ConfigHistoryEntry[]> => {
  const response = await axiosInstance.get(`/config/${encodeURIComponent(key)}/history`);
  return (response.data?.history ?? []) as ConfigHistoryEntry[];
};

export const restoreConfigDefaults = async (
  password: string,
): Promise<{ seededCount: number; seededKeys: string[] }> => {
  const response = await axiosInstance.post("/config/seed/restore", { password });
  return response.data as { seededCount: number; seededKeys: string[] };
};

export const runConfigSeed = async (
  seedKey: string,
  force = false,
): Promise<{ seedKey: string; result: { skipped: boolean; seededCount: number; details?: Record<string, unknown> | null } }> => {
  const response = await axiosInstance.post("/config/seed/run", { seedKey, force });
  return response.data as {
    seedKey: string;
    result: { skipped: boolean; seededCount: number; details?: Record<string, unknown> | null };
  };
};

export type SeedCatalogEntry = {
  key: string;
  label: string;
  description: string;
  group: string;
  sortOrder: number;
};

export const fetchSeedCatalog = async (): Promise<SeedCatalogEntry[]> => {
  const response = await axiosInstance.get("/config/seed/catalog");
  return (response.data?.seeds ?? []) as SeedCatalogEntry[];
};

export const fetchSeedPreview = async (seedKey: string): Promise<{
  preview: {
    supported: boolean;
    seedKey: string;
    pendingCount: number;
    details?: Record<string, unknown> | null;
  };
}> => {
  const response = await axiosInstance.get("/config/seed/preview", { params: { seedKey } });
  return response.data as {
    preview: {
      supported: boolean;
      seedKey: string;
      pendingCount: number;
      details?: Record<string, unknown> | null;
    };
  };
};

export const markConfigSeedRun = async (seedKey: string): Promise<{ seedKey: string; status: string }> => {
  const response = await axiosInstance.post("/config/seed/mark", { seedKey });
  return response.data as { seedKey: string; status: string };
};
