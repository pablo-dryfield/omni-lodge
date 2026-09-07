import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";

export type VolunteerMilestoneKey =
  | "reviews"
  | "attendance"
  | "monthly_shifts"
  | "cleaning"
  | "management_feedback";

export type VolunteerMilestoneState = "earned" | "in_progress" | "locked";
export type VolunteerAttendanceStatus = "attended" | "late" | "absent" | "excused";

export type VolunteerMilestonePeriod = {
  month: string;
  startDate: string;
  endDate: string;
  asOfDate: string;
  timezone: string;
};

export type VolunteerMilestoneEvidence = {
  id?: string | number;
  label: string;
  detail?: string | null;
  occurredAt?: string | null;
  status?: string | null;
};

export type VolunteerMilestone = {
  key: VolunteerMilestoneKey;
  title: string;
  current: number;
  target: number;
  unit: string;
  progressPercent: number;
  earned: boolean;
  state: VolunteerMilestoneState;
  remainingText: string;
  reason: string;
  evidence: VolunteerMilestoneEvidence[];
  expectedToDate?: number;
  subtargets?: Array<{
    key: string;
    title: string;
    current: number;
    target: number;
    expectedToDate: number;
    unit: string;
  }>;
};

export type VolunteerStayPosition = "guide" | "social_media";
export type VolunteerStayTargets = {
  reviews: number;
  guidingShifts: number;
  promotionShifts: number;
  socialMediaShifts: number;
  cleaningTasks: number;
  attendancePercent: number;
};
export type VolunteerStayShiftTypes = {
  guiding: number[];
  promotion: number[];
  socialMedia: number[];
};
export type VolunteerStay = {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  position: VolunteerStayPosition;
  monthlyTargets: VolunteerStayTargets;
  shiftTypeIds: VolunteerStayShiftTypes;
  changeReason: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerMilestoneUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  profilePhotoUrl: string | null;
  hasStoredProfilePhoto?: boolean;
  profilePhotoVersion?: string | null;
};

export type VolunteerAttendanceAssignment = {
  assignmentId: number;
  shiftInstanceId: number;
  date: string;
  startTime: string;
  endTime: string | null;
  shiftName: string;
  role: string | null;
  status: VolunteerAttendanceStatus | null;
  notes: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
  isPast: boolean;
};

export type VolunteerManagementFeedback = {
  approved: boolean;
  feedback: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type VolunteerMilestoneDetail = {
  period: VolunteerMilestonePeriod;
  user: VolunteerMilestoneUser;
  starsEarned: number;
  totalStars: 5;
  milestones: VolunteerMilestone[];
  attendanceAssignments: VolunteerAttendanceAssignment[];
  managementFeedback: VolunteerManagementFeedback | null;
};

export type VolunteerMilestoneSummary = {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  profilePhotoUrl: string | null;
  active: boolean;
  starsEarned: number;
  totalStars: 5;
  milestones: VolunteerMilestone[];
};

export type VolunteerMilestoneList = {
  period: VolunteerMilestonePeriod;
  volunteers: VolunteerMilestoneSummary[];
};

export type VolunteerStayProgress = {
  mode: "stay";
  user: VolunteerMilestoneUser & { arrivalDate: string | null; departureDate: string | null };
  active: boolean;
  stay: VolunteerStay | null;
  stays: VolunteerStay[];
  setupRequired: boolean;
  suggestedStay: {
    startDate: string | null;
    endDate: string | null;
    position: VolunteerStayPosition;
    monthlyTargets: VolunteerStayTargets;
    shiftTypeIds: VolunteerStayShiftTypes;
  };
  targetSummary: {
    equivalentMonths: number;
    elapsedMonths: number;
    targets: VolunteerStayTargets;
    expectedToDate: VolunteerStayTargets;
  } | null;
  asOfDate: string;
  timezone: string;
  starsEarned: number;
  totalStars: 5;
  milestones: VolunteerMilestone[];
  attendanceAssignments: VolunteerAttendanceAssignment[];
  managementFeedback: VolunteerManagementFeedback | null;
  warnings: string[];
  shiftTypes: Array<{ id: number; key: string; name: string }>;
};

export type VolunteerStayList = {
  mode: "stay";
  volunteers: VolunteerStayProgress[];
  shiftTypes: Array<{ id: number; key: string; name: string }>;
};

export type VolunteerProgressReport = VolunteerMilestoneDetail | VolunteerStayProgress;

export type SaveVolunteerStayInput = {
  userId: number;
  stayId?: number;
  expectedRevision?: number;
  startDate: string;
  endDate: string;
  position: VolunteerStayPosition;
  monthlyTargets: VolunteerStayTargets;
  shiftTypeIds: VolunteerStayShiftTypes;
  changeReason?: string;
};

type ApiErrorBody = { error?: string; message?: string } | Array<{ error?: string; message?: string }>;
export type VolunteerMilestoneApiError = AxiosError<ApiErrorBody>;

export const shouldRetryVolunteerStayQuery = (failureCount: number, error: VolunteerMilestoneApiError): boolean => {
  const status = error.response?.status;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 1;
};

export const volunteerMilestoneKeys = {
  all: ["volunteer-milestones"] as const,
  mine: (period: string) => ["volunteer-milestones", "me", period] as const,
  list: (period: string) => ["volunteer-milestones", "list", period] as const,
  detail: (userId: number, period: string) =>
    ["volunteer-milestones", "detail", userId, period] as const,
  stays: ["volunteer-milestones", "stays"] as const,
  stayDetail: (userId: number | null, stayId?: number | null) =>
    ["volunteer-milestones", "stay", userId ?? "me", stayId ?? "current"] as const,
};

export const fetchVolunteerStayList = async (): Promise<VolunteerStayList> => {
  const response = await axiosInstance.get<VolunteerStayList>("/volunteerMilestones");
  return response.data;
};

export const fetchVolunteerStayProgress = async (
  userId: number | null,
  stayId?: number | null,
): Promise<VolunteerStayProgress> => {
  const response = await axiosInstance.get<VolunteerStayProgress>(
    userId === null ? "/volunteerMilestones/me" : `/volunteerMilestones/${userId}`,
    { params: stayId ? { stayId } : {} },
  );
  return response.data;
};

export const useVolunteerStayList = (enabled: boolean) => useQuery<VolunteerStayList, VolunteerMilestoneApiError>({
  queryKey: volunteerMilestoneKeys.stays,
  queryFn: fetchVolunteerStayList,
  enabled,
  retry: shouldRetryVolunteerStayQuery,
  staleTime: 30_000,
});

export const useVolunteerStayProgress = (userId: number | null, stayId: number | null, enabled: boolean) => useQuery<
  VolunteerStayProgress,
  VolunteerMilestoneApiError
>({
  queryKey: volunteerMilestoneKeys.stayDetail(userId, stayId),
  queryFn: () => fetchVolunteerStayProgress(userId, stayId),
  enabled,
  retry: shouldRetryVolunteerStayQuery,
  staleTime: 30_000,
});

export const saveVolunteerStay = async ({ userId, stayId, ...payload }: SaveVolunteerStayInput): Promise<VolunteerStayProgress> => {
  const response = stayId
    ? await axiosInstance.patch<VolunteerStayProgress>(`/volunteerMilestones/${userId}/stays/${stayId}`, payload)
    : await axiosInstance.post<VolunteerStayProgress>(`/volunteerMilestones/${userId}/stays`, payload);
  return response.data;
};

export const useSaveVolunteerStay = () => {
  const queryClient = useQueryClient();
  return useMutation<VolunteerStayProgress, VolunteerMilestoneApiError, SaveVolunteerStayInput>({
    mutationFn: saveVolunteerStay,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.all }),
    onError: async (error) => {
      if (error.response?.status === 409) await queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.all });
    },
  });
};

export const updateVolunteerStayFeedback = async ({
  userId,
  stayId,
  ...payload
}: { userId: number; stayId: number; expectedRevision: number; approved: boolean; feedback: string }): Promise<VolunteerStayProgress> => {
  const response = await axiosInstance.patch<VolunteerStayProgress>(
    `/volunteerMilestones/${userId}/stays/${stayId}/feedback`,
    payload,
  );
  return response.data;
};

export const useUpdateVolunteerStayFeedback = () => {
  const queryClient = useQueryClient();
  return useMutation<
    VolunteerStayProgress,
    VolunteerMilestoneApiError,
    Parameters<typeof updateVolunteerStayFeedback>[0]
  >({
    mutationFn: updateVolunteerStayFeedback,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.all }),
    onError: async (error) => {
      if (error.response?.status === 409) await queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.all });
    },
  });
};

export const getVolunteerMilestoneErrorMessage = (
  error: unknown,
  fallback = "Unable to load volunteer progress.",
): string => {
  const axiosError = error as VolunteerMilestoneApiError | undefined;
  const responseData = axiosError?.response?.data;
  const payload = Array.isArray(responseData) ? responseData[0] : responseData;
  const message = payload?.message ?? payload?.error;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

export const fetchMyVolunteerMilestones = async (period: string): Promise<VolunteerMilestoneDetail> => {
  const response = await axiosInstance.get<VolunteerMilestoneDetail>("/volunteerMilestones/me", {
    params: { period },
  });
  return response.data;
};

export const fetchVolunteerMilestoneList = async (period: string): Promise<VolunteerMilestoneList> => {
  const response = await axiosInstance.get<VolunteerMilestoneList>("/volunteerMilestones", {
    params: { period },
  });
  return response.data;
};

export const fetchVolunteerMilestoneDetail = async (
  userId: number,
  period: string,
): Promise<VolunteerMilestoneDetail> => {
  const response = await axiosInstance.get<VolunteerMilestoneDetail>(
    `/volunteerMilestones/${userId}`,
    { params: { period } },
  );
  return response.data;
};

export const useMyVolunteerMilestones = (period: string, enabled = true) =>
  useQuery<VolunteerMilestoneDetail, VolunteerMilestoneApiError>({
    queryKey: volunteerMilestoneKeys.mine(period),
    queryFn: () => fetchMyVolunteerMilestones(period),
    enabled,
    staleTime: 30_000,
  });

export const useVolunteerMilestoneList = (period: string, enabled = true) =>
  useQuery<VolunteerMilestoneList, VolunteerMilestoneApiError>({
    queryKey: volunteerMilestoneKeys.list(period),
    queryFn: () => fetchVolunteerMilestoneList(period),
    enabled,
    staleTime: 30_000,
  });

export const useVolunteerMilestoneDetail = (
  userId: number | null,
  period: string,
  enabled = true,
) =>
  useQuery<VolunteerMilestoneDetail, VolunteerMilestoneApiError>({
    queryKey:
      userId === null
        ? [...volunteerMilestoneKeys.all, "detail", "disabled", period]
        : volunteerMilestoneKeys.detail(userId, period),
    queryFn: async () => {
      if (userId === null) {
        throw new Error("Select a volunteer to view progress.");
      }
      return fetchVolunteerMilestoneDetail(userId, period);
    },
    enabled: enabled && userId !== null,
    staleTime: 30_000,
  });

export type AttendanceMutationInput = {
  assignmentId: number;
  status: VolunteerAttendanceStatus;
  notes?: string;
  stayId?: number;
};

export const updateVolunteerAttendanceRecord = async ({
  assignmentId,
  status,
  notes,
  stayId,
}: AttendanceMutationInput): Promise<unknown> => {
  const payload = {
    status,
    ...(notes !== undefined ? { notes: notes.trim() } : {}),
  };
  const path = `/volunteerMilestones/attendance/${assignmentId}`;
  const response = stayId
    ? await axiosInstance.put(path, payload, { params: { stayId } })
    : await axiosInstance.put(path, payload);
  return response.data;
};

export const useUpdateVolunteerAttendance = () => {
  const queryClient = useQueryClient();
  return useMutation<unknown, VolunteerMilestoneApiError, AttendanceMutationInput>({
    mutationFn: updateVolunteerAttendanceRecord,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.all }),
  });
};

export type FeedbackMutationInput = {
  userId: number;
  period: string;
  approved: boolean;
  feedback?: string;
};

export const updateVolunteerFeedback = async ({
  userId,
  period,
  approved,
  feedback,
}: FeedbackMutationInput): Promise<VolunteerMilestoneDetail> => {
  const response = await axiosInstance.patch<VolunteerMilestoneDetail>(
    `/volunteerMilestones/${userId}/${period}/feedback`,
    {
      approved,
      ...(feedback?.trim() ? { feedback: feedback.trim() } : { feedback: null }),
    },
  );
  return response.data;
};

export const useUpdateVolunteerFeedback = () => {
  const queryClient = useQueryClient();
  return useMutation<VolunteerMilestoneDetail, VolunteerMilestoneApiError, FeedbackMutationInput>({
    mutationFn: updateVolunteerFeedback,
    onSuccess: (detail) => {
      queryClient.setQueryData(volunteerMilestoneKeys.detail(detail.user.id, detail.period.month), detail);
      queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.list(detail.period.month) });
      queryClient.invalidateQueries({ queryKey: volunteerMilestoneKeys.mine(detail.period.month) });
    },
  });
};
