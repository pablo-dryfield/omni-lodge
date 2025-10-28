import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";\r\nimport isoWeek from "dayjs/plugin/isoWeek";\r\nimport type { AxiosError } from "axios";
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
  SwapRequest,
} from "../types/scheduling";

dayjs.extend(isoWeek);

const schedulingBaseKey = ["scheduling"] as const;

const schedulingKeys = {
  base: schedulingBaseKey,
  weekSummary: (weekId: number) => [...schedulingBaseKey, "week", weekId] as const,
  shiftTemplates: [...schedulingBaseKey, "templates"] as const,
  shiftInstances: (weekId: number) => [...schedulingBaseKey, "instances", weekId] as const,
  availability: (weekId: number) => [...schedulingBaseKey, "availability", weekId] as const,
  swaps: (status: string) => [...schedulingBaseKey, "swaps", status] as const,
  mySwaps: [...schedulingBaseKey, "swaps", "mine"] as const,
  exports: (weekId: number) => [...schedulingBaseKey, "exports", weekId] as const,
  reports: (params: ReportsQuery) => [...schedulingBaseKey, "reports", params.from, params.to, params.userId ?? "all"] as const,
  ensureWeek: (weekValue: string | null) => [...schedulingBaseKey, "ensure-week", weekValue ?? "current"] as const,
};

type WeekQueryParams = { week?: string | null };

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
      queryClient.invalidateQueries(schedulingKeys.weekSummary(result.week.id));
    },
  });
};

export const useEnsureWeek = (weekValue: string | null, options?: { allowGenerate?: boolean }) => {
  const queryClient = useQueryClient();
  const allowGenerate = options?.allowGenerate ?? false;

  return useQuery({
    queryKey: schedulingKeys.ensureWeek(weekValue),
    queryFn: async () => {
      if (!weekValue) {
        throw new Error("Week value is required");
      }

      const fetchExisting = async () => {
        const response = await axiosInstance.get("/schedules/weeks/lookup", {
          params: { week: weekValue },
        });
        return response.data as { week: ScheduleWeekSummary["week"]; created: boolean };
      };

      let result: { week: ScheduleWeekSummary["week"]; created: boolean };

      if (allowGenerate) {
        try {
          const response = await axiosInstance.post("/schedules/weeks/generate", null, {
            params: { week: weekValue },
          });
          result = response.data as { week: ScheduleWeekSummary["week"]; created: boolean };
        } catch (error) {
          const axiosError = error as AxiosError;
          if (axiosError.response?.status === 401 || axiosError.response?.status === 404) {
            result = await fetchExisting();
          } else {
            throw error;
          }
        }
      } else {
        result = await fetchExisting();
      }

      queryClient.invalidateQueries(schedulingKeys.weekSummary(result.week.id));
      return result;
    },
    enabled: Boolean(weekValue),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
};

export const useWeekSummary = (weekId: number | null) =>
  useQuery({
    queryKey: weekId ? schedulingKeys.weekSummary(weekId) : undefined,
    queryFn: async () => {
      const response = await axiosInstance.get(`/schedules/weeks/${weekId}`);
      return response.data as ScheduleWeekSummary;
    },
    enabled: Boolean(weekId),
  });

export const useLockWeek = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weekId: number) => {
      const response = await axiosInstance.post(`/schedules/weeks/${weekId}/lock`);
      return response.data as ScheduleWeekSummary;
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries(schedulingKeys.weekSummary(summary.week.id));
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
      queryClient.invalidateQueries(schedulingKeys.weekSummary(summary.week.id));
      queryClient.invalidateQueries(schedulingKeys.exports(summary.week.id));
    },
  });
};

export const useShiftTemplates = () =>
  useQuery({
    queryKey: schedulingKeys.shiftTemplates,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/shift-templates");
      return response.data as ShiftTemplate[];
    },
  });

export const useUpsertShiftTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<ShiftTemplate> & { shiftTypeId: number; name: string }) => {
      const response = await axiosInstance.post("/schedules/shift-templates", payload);
      return response.data as ShiftTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(schedulingKeys.shiftTemplates);
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
      queryClient.invalidateQueries(schedulingKeys.shiftTemplates);
    },
  });
};

export const useShiftInstances = (weekId: number | null) =>
  useQuery({
    queryKey: weekId ? schedulingKeys.shiftInstances(weekId) : undefined,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/shift-instances", { params: { weekId } });
      return response.data as ShiftInstance[];
    },
    enabled: Boolean(weekId),
  });

export const useCreateShiftInstance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ShiftInstancePayload) => {
      const response = await axiosInstance.post("/schedules/shift-instances", payload);
      return response.data as ShiftInstance;
    },
    onSuccess: (instance) => {
      queryClient.invalidateQueries(schedulingKeys.shiftInstances(instance.scheduleWeekId));
      queryClient.invalidateQueries(schedulingKeys.weekSummary(instance.scheduleWeekId));
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
      queryClient.invalidateQueries(schedulingKeys.shiftInstances(instance.scheduleWeekId));
      queryClient.invalidateQueries(schedulingKeys.weekSummary(instance.scheduleWeekId));
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
      queryClient.invalidateQueries(schedulingKeys.shiftInstances(weekId));
      queryClient.invalidateQueries(schedulingKeys.weekSummary(weekId));
    },
  });
};

export const useAvailability = (weekId: number | null) =>
  useQuery({
    queryKey: weekId ? schedulingKeys.availability(weekId) : undefined,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/availability/me", { params: { weekId } });
      return response.data as AvailabilityPayload["entries"];
    },
    enabled: Boolean(weekId),
  });

export const useSaveAvailability = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AvailabilityPayload) => {
      const response = await axiosInstance.post("/schedules/availability", payload);
      return response.data as AvailabilityPayload["entries"];
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries(schedulingKeys.availability(payload.scheduleWeekId));
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
      queryClient.invalidateQueries(schedulingKeys.shiftInstances(weekId));
      queryClient.invalidateQueries(schedulingKeys.weekSummary(weekId));
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
      queryClient.invalidateQueries(schedulingKeys.shiftInstances(weekId));
      queryClient.invalidateQueries(schedulingKeys.weekSummary(weekId));
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
      queryClient.invalidateQueries({ queryKey: schedulingKeys.mySwaps });
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
      queryClient.invalidateQueries({ queryKey: schedulingKeys.mySwaps });
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
      queryClient.invalidateQueries({ queryKey: schedulingKeys.base });
    },
  });
};

export const useScheduleExports = (weekId: number | null) =>
  useQuery({
    queryKey: weekId ? schedulingKeys.exports(weekId) : undefined,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/exports", { params: { weekId } });
      return response.data as ScheduleExport[];
    },
    enabled: Boolean(weekId),
  });

export const useScheduleReports = (params: ReportsQuery | null) =>
  useQuery({
    queryKey: params ? schedulingKeys.reports(params) : undefined,
    queryFn: async () => {
      const response = await axiosInstance.get("/schedules/reports/schedules", { params });
      return response.data as ShiftAssignment[];
    },
    enabled: Boolean(params?.from && params?.to),
  });

export const formatScheduleWeekLabel = (year: number, week: number) =>
  `Week ${week.toString().padStart(2, "0")} / ${year}`;

export const getUpcomingWeeks = (count = 4) => {
  const base = dayjs();
  return Array.from({ length: count }).map((_, index) => {
    const target = base.add(index, "week");
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

