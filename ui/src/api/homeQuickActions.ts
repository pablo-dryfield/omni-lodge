import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";

export type HomeQuickActionAudienceMode = "all" | "targeted";

export type HomeQuickActionConfigDto = {
  actionId: string;
  enabled: boolean;
  audienceMode: HomeQuickActionAudienceMode;
  allowUserIds: number[];
  denyUserIds: number[];
  userTypeIds: number[];
  shiftRoleIds: number[];
  staffProfileTypes: string[];
};

export type HomeQuickActionAudienceUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  userTypeId: number | null;
  shiftRoleIds: number[];
  staffProfileType: string | null;
};

export type HomeQuickActionBootstrap = {
  configurations: HomeQuickActionConfigDto[];
  options: {
    users: HomeQuickActionAudienceUser[];
    userTypes: Array<{ id: number; name: string; slug: string; active: boolean }>;
    shiftRoles: Array<{ id: number; name: string; slug: string }>;
    staffProfileTypes: Array<{ value: string; label: string }>;
  };
};

export const HOME_QUICK_ACTION_CONFIG_QUERY_KEY = [
  "reports",
  "home-quick-actions",
  "configuration",
] as const;

export const useHomeQuickActionConfiguration = (options?: { enabled?: boolean }) =>
  useQuery<HomeQuickActionBootstrap, AxiosError<{ message?: string }>>({
    queryKey: HOME_QUICK_ACTION_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const response = await axiosInstance.get<HomeQuickActionBootstrap>(
        "/reports/home-quick-actions/bootstrap",
      );
      return response.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export const useUpdateHomeQuickActionConfiguration = () => {
  const queryClient = useQueryClient();
  return useMutation<
    { configurations: HomeQuickActionConfigDto[] },
    AxiosError<{ message?: string }>,
    { configurations: HomeQuickActionConfigDto[] }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.put<{ configurations: HomeQuickActionConfigDto[] }>(
        "/reports/home-quick-actions/configuration",
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HOME_QUICK_ACTION_CONFIG_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["reports", "home-preference"] });
    },
  });
};
