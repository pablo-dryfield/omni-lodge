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
};

export type VolunteerMilestoneUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  profilePhotoUrl: string | null;
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

type ApiErrorBody = { error?: string; message?: string } | Array<{ error?: string; message?: string }>;
export type VolunteerMilestoneApiError = AxiosError<ApiErrorBody>;

export const volunteerMilestoneKeys = {
  all: ["volunteer-milestones"] as const,
  mine: (period: string) => ["volunteer-milestones", "me", period] as const,
  list: (period: string) => ["volunteer-milestones", "list", period] as const,
  detail: (userId: number, period: string) =>
    ["volunteer-milestones", "detail", userId, period] as const,
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
};

export const updateVolunteerAttendanceRecord = async ({
  assignmentId,
  status,
  notes,
}: AttendanceMutationInput): Promise<unknown> => {
  const response = await axiosInstance.put(`/volunteerMilestones/attendance/${assignmentId}`, {
    status,
    ...(notes !== undefined ? { notes: notes.trim() } : {}),
  });
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
