import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";
import type {
  AssignmentInput,
  AvailabilityPayload,
  ReportsQuery,
  ScheduleExport,
  ScheduleWeekSummary,
  ShiftAssignment,
  ShiftInstance,
  ShiftInstancePayload,
  ShiftTemplate,
  ShiftType,
  SwapRequest,
} from "../types/scheduling";

dayjs.extend(isoWeek);

const schedulingBaseKey = ["scheduling"] as const;

const disabledKey = (key: string) => [...schedulingBaseKey, "disabled", key] as const;

const invalidateQuery = (client: QueryClient, key: QueryKey) => {
  client.invalidateQueries({ queryKey: key });
};

type EnsureWeekResult = { week: ScheduleWeekSummary["week"] | null; created: boolean };

const schedulingKeys = {
  base: schedulingBaseKey,
  weekSummary: (weekId: number) => [...schedulingBaseKey, "week", weekId] as const,
  shiftTemplates: [...schedulingBaseKey, "templates"] as const,
  shiftTypes: [...schedulingBaseKey, "shift-types"] as const,
  shiftInstances: (weekId: number) => [...schedulingBaseKey, "instances", weekId] as const,
  availability: (weekId: number) => [...schedulingBaseKey, "availability", weekId] as const,
  swaps: (status: string) => [...schedulingBaseKey, "swaps", status] as const,
  mySwaps: [...schedulingBaseKey, "swaps", "mine"] as const,
  exports: (weekId: number) => [...schedulingBaseKey, "exports", weekId] as const,
  reports: (params: ReportsQuery) => [...schedulingBaseKey, "reports", params.from, params.to, params.userId ?? "all"] as const,
  ensureWeek: (weekValue: string | null) => [...schedulingBaseKey, "ensure-week", weekValue ?? "current"] as const,
};

type WeekQueryParams = { week?: string | null };

export type AutoAssignSummary = {
  created: number;
  removed: number;
  volunteerCount: number;
  unfilled: Array<{ shiftInstanceId: number; role: string; date: string; timeStart: string }>;
  volunteerAssignments: Array<{ userId: number; fullName: string | null; assigned: number }>;
};

export const useGenerateWeek = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: WeekQueryParams = {}) => {
      const response = await axiosInstance.post("/schedules/weeks/generate", null, {
        params: params.week ? { week: params.week } : undefined,
      });
      return response.data as { week: ScheduleWeekSummary["week"]; created: boolean };
    },
    onSuccess: (result) => {
      invalidateQuery(queryClient, schedulingKeys.weekSummary(result.week.id));
    },
  });
};

export const useEnsureWeek = (
  weekValue: string | null,
  options?: { allowGenerate?: boolean; enabled?: boolean },
) => {
  const queryClient = useQueryClient();
  const allowGenerate = options?.allowGenerate ?? false;
  const enabled = Boolean(weekValue) && (options?.enabled ?? true);

  return useQuery<EnsureWeekResult>({
    queryKey: weekValue && enabled ? schedulingKeys.ensureWeek(weekValue) : disabledKey("ensure-week"),
    queryFn: async () => {
      if (!weekValue) {
        return { week: null, created: false };
      }

      const fetchExisting = async (): Promise<EnsureWeekResult> => {
        try {
          const response = await axiosInstance.get("/schedules/weeks/lookup", {
            params: { week: weekValue },
          });
          return response.data as EnsureWeekResult;
        } catch (error) {
          const axiosError = error as AxiosError;
          if (axiosError.response?.status === 404) {
            return { week: null, created: false };
          }
          throw error;
        }
      };

      let result: EnsureWeekResult;

      if (allowGenerate) {
        const tryGenerate = async (): Promise<EnsureWeekResult> => {
          try {
            const response = await axiosInstance.post("/schedules/weeks/generate", null, {
              params: { week: weekValue },
            });
            return response.data as EnsureWeekResult;
          } catch (error) {
            const axiosError = error as AxiosError<{ error?: string; message?: string }>;
            const status = axiosError.response?.status;
            const backendMessage = axiosError.response?.data?.error ?? axiosError.response?.data?.message;

            if (status === 401 || status === 403 || status === 404) {
              const existing = await fetchExisting();
              if (!existing.week && status === 403) {
                throw new Error(
                  backendMessage ??
                    "You do not have permission to generate schedule weeks. Please contact an administrator.",
                );
              }
              return existing;
            }
            throw new Error(backendMessage ?? axiosError.message);
          }
        };
        result = await tryGenerate();
      } else {
        result = await fetchExisting();
      }

      if (result.week) {
        invalidateQuery(queryClient, schedulingKeys.weekSummary(result.week.id));
      }
      return result;
    },
    enabled,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
};

export const useWeekSummary = (weekId: number | null) =>
  useQuery({
    queryKey: weekId !== null ? schedulingKeys.weekSummary(weekId) : disabledKey("week"),
    queryFn: async () => {
      const response = await axiosInstance.get(`/schedules/weeks/${weekId}`);
      return response.data as ScheduleWeekSummary;
    },
    enabled: weekId !== null,
  });

export const useLockWeek = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weekId: number) => {
      const response = await axiosInstance.post(`/schedules/weeks/${weekId}/lock`);
      return response.data as ScheduleWeekSummary;
    },
    onSuccess: (summary) => {
      invalidateQuery(queryClient, schedulingKeys.weekSummary(summary.week.id));
    },
  });
};

export const usePublishWeek = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weekId: number) => {
      const response = await axiosInstance.post(`/schedules/weeks/${weekId}/publish`);
      return response.data as { exports: ScheduleExport[]; summary: ScheduleWeekSummary };
    },
    onSuccess: ({ summary }) => {
      invalidateQuery(queryClient, schedulingKeys.weekSummary(summary.week.id));
      invalidateQuery(queryClient, schedulingKeys.exports(summary.week.id));
    },
  });
};

export const useAutoAssignWeek = () => {
  const queryClient = useQueryClient();
  return useMutation<AutoAssignSummary, AxiosError<{ error?: string; message?: string }>, { weekId: number }>({
    mutationFn: async ({ weekId }) => {
      const response = await axiosInstance.post(`/schedules/weeks/${weekId}/auto-assign`);
      return response.data as AutoAssignSummary;
    },
    onSuccess: (_data, variables) => {
      invalidateQuery(queryClient, schedulingKeys.shiftInstances(variables.weekId));
      invalidateQuery(queryClient, schedulingKeys.weekSummary(variables.weekId));
    },
  });
};

export const useShiftTemplates = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: schedulingKeys.shiftTemplates,
    queryFn: async () => {
      try {
        const response = await axiosInstance.get("/schedules/shift-templates");
        return response.data as ShiftTemplate[];
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 403) {
          return [];
        }
        throw error;
      }
    },
    enabled: options?.enabled ?? true,
    retry: false,
  });

export const useShiftTypes = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: schedulingKeys.shiftTypes,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/shift-types");
      return response.data as ShiftType[];
    },
    enabled: options?.enabled ?? true,
    retry: false,
  });

export const useUpsertShiftTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<ShiftTemplate> & { shiftTypeId: number; name: string }) => {
      const response = await axiosInstance.post("/schedules/shift-templates", payload);
      return response.data as ShiftTemplate;
    },
    onSuccess: () => {
      invalidateQuery(queryClient, schedulingKeys.shiftTemplates);
    },
  });
};

export const useDeleteShiftTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: number) => {
      await axiosInstance.delete(`/schedules/shift-templates/${templateId}`);
    },
    onSuccess: () => {
      invalidateQuery(queryClient, schedulingKeys.shiftTemplates);
    },
  });
};

export const useShiftInstances = (weekId: number | null) =>
  useQuery({
    queryKey: weekId !== null ? schedulingKeys.shiftInstances(weekId) : disabledKey("instances"),
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/shift-instances", { params: { weekId } });
      return response.data as ShiftInstance[];
    },
    enabled: weekId !== null,
  });

export const useCreateShiftInstance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ShiftInstancePayload) => {
      const response = await axiosInstance.post("/schedules/shift-instances", payload);
      return response.data as ShiftInstance;
    },
    onSuccess: (instance) => {
      invalidateQuery(queryClient, schedulingKeys.shiftInstances(instance.scheduleWeekId));
      invalidateQuery(queryClient, schedulingKeys.weekSummary(instance.scheduleWeekId));
    },
  });
};

export const useUpdateShiftInstance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ShiftInstancePayload> }) => {
      const response = await axiosInstance.patch(`/schedules/shift-instances/${id}`, data);
      return response.data as ShiftInstance;
    },
    onSuccess: (instance) => {
      invalidateQuery(queryClient, schedulingKeys.shiftInstances(instance.scheduleWeekId));
      invalidateQuery(queryClient, schedulingKeys.weekSummary(instance.scheduleWeekId));
    },
  });
};

export const useDeleteShiftInstance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, weekId }: { id: number; weekId: number }) => {
      await axiosInstance.delete(`/schedules/shift-instances/${id}`);
      return weekId;
    },
    onSuccess: (weekId) => {
      invalidateQuery(queryClient, schedulingKeys.shiftInstances(weekId));
      invalidateQuery(queryClient, schedulingKeys.weekSummary(weekId));
    },
  });
};

export const useAvailability = (weekId: number | null) =>
  useQuery({
    queryKey: weekId !== null ? schedulingKeys.availability(weekId) : disabledKey("availability"),
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/availability/me", { params: { weekId } });
      return response.data as AvailabilityPayload["entries"];
    },
    enabled: weekId !== null,
  });

export const useSaveAvailability = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AvailabilityPayload) => {
      const response = await axiosInstance.post("/schedules/availability", payload);
      return response.data as AvailabilityPayload["entries"];
    },
    onSuccess: (_, payload) => {
      invalidateQuery(queryClient, schedulingKeys.availability(payload.scheduleWeekId));
    },
  });
};

export const useAssignShifts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { assignments: AssignmentInput[]; weekId: number }) => {
      const response = await axiosInstance.post("/schedules/shift-assignments/bulk", {
        assignments: payload.assignments,
      });
      return { assignments: response.data as ShiftAssignment[], weekId: payload.weekId };
    },
    onSuccess: ({ weekId }) => {
      invalidateQuery(queryClient, schedulingKeys.shiftInstances(weekId));
      invalidateQuery(queryClient, schedulingKeys.weekSummary(weekId));
    },
  });
};

export const useDeleteAssignment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assignmentId, weekId }: { assignmentId: number; weekId: number }) => {
      await axiosInstance.delete(`/schedules/shift-assignments/${assignmentId}`);
      return weekId;
    },
    onSuccess: (weekId) => {
      invalidateQuery(queryClient, schedulingKeys.shiftInstances(weekId));
      invalidateQuery(queryClient, schedulingKeys.weekSummary(weekId));
    },
  });
};

export const useSwaps = (status: string) =>
  useQuery({
    queryKey: schedulingKeys.swaps(status),
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/swaps", { params: { status } });
      return response.data as SwapRequest[];
    },
  });

export const useMySwaps = () =>
  useQuery({
    queryKey: schedulingKeys.mySwaps,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/swaps/mine");
      return response.data as SwapRequest[];
    },
  });

export const useCreateSwap = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => {
      const response = await axiosInstance.post("/schedules/swaps", payload);
      return response.data as SwapRequest;
    },
    onSuccess: () => {
      invalidateQuery(queryClient, schedulingKeys.mySwaps);
    },
  });
};

export const usePartnerSwapResponse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ swapId, accept }: { swapId: number; accept: boolean }) => {
      const response = await axiosInstance.post(`/schedules/swaps/${swapId}/partner-response`, { accept });
      return response.data as SwapRequest;
    },
    onSuccess: () => {
      invalidateQuery(queryClient, schedulingKeys.mySwaps);
    },
  });
};

export const useManagerSwapDecision = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ swapId, approve, reason }: { swapId: number; approve: boolean; reason?: string }) => {
      const response = await axiosInstance.post(`/schedules/swaps/${swapId}/manager-decision`, { approve, reason });
      return response.data as SwapRequest;
    },
    onSuccess: () => {
      invalidateQuery(queryClient, schedulingKeys.base);
    },
  });
};

export const useScheduleExports = (weekId: number | null) =>
  useQuery({
    queryKey: weekId !== null ? schedulingKeys.exports(weekId) : disabledKey("exports"),
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/exports", { params: { weekId } });
      return response.data as ScheduleExport[];
    },
    enabled: weekId !== null,
  });

export const useScheduleReports = (params: ReportsQuery | null) =>
  useQuery({
    queryKey: params ? schedulingKeys.reports(params) : disabledKey("reports"),
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/reports/schedules", { params });
      return response.data as ShiftAssignment[];
    },
    enabled: Boolean(params?.from && params?.to),
  });

export const formatScheduleWeekLabel = (year: number, week: number) =>
  `Week ${week.toString().padStart(2, "0")} / ${year}`;

export const getUpcomingWeeks = (count = 4, includeCurrent = true) => {
  const base = dayjs();
  return Array.from({ length: count }).map((_, index) => {
    const offset = includeCurrent ? index : index + 1;
    const target = base.add(offset, "week");
    const year = target.isoWeekYear();
    const week = target.isoWeek();
    return {
      value: `${year}-W${week.toString().padStart(2, "0")}`,
      label: formatScheduleWeekLabel(year, week),
      year,
      week,
    };
  });
};
