import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";
import type { FinanceManagementRequest } from "../types/finance";
import type { ShiftRequest, SwapRequest } from "../types/scheduling";
import type { User } from "../types/users/User";

export type UserApprovalRequest = Partial<User> & {
  id: number;
  role?: {
    id: number;
    name: string;
    slug: string;
  } | null;
  shiftRoles?: Array<{
    id: number;
    name: string;
    slug?: string | null;
  }>;
  staffProfile?: {
    staffType?: string | null;
    livesInAccom?: boolean | null;
    active?: boolean | null;
  } | null;
};

export type RequestsSummary = {
  total: number;
  userApprovals: number;
  scheduleSwaps: number;
  scheduleRequests?: number;
  financeRequests: number;
  popupRequests?: number;
};

export type PopupRequestRecipientStatus = "not_opened" | "prompted" | "completed" | "dismissed";

export type PopupRequestRecipient = {
  userId: number;
  name: string;
  email?: string | null;
  status: PopupRequestRecipientStatus;
  promptedAt?: string | null;
  lastPromptedAt?: string | null;
  promptCount: number;
  completedAt?: string | null;
  response?: Record<string, unknown>;
};

export type PopupRequestAudit = {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  status: boolean;
  requiresSignature: boolean;
  createdAt: string;
  sentCount: number;
  notOpenedCount: number;
  promptedCount: number;
  completedCount: number;
  dismissedCount: number;
  recipients: PopupRequestRecipient[];
};

export type RequestsCenterResponse = {
  userApprovals: UserApprovalRequest[];
  scheduleSwaps: SwapRequest[];
  scheduleRequests?: ShiftRequest[];
  financeRequests: FinanceManagementRequest[];
  popupRequests: PopupRequestAudit[];
  summary: RequestsSummary;
};

const requestsKey = ["requests-center"] as const;

export const useRequestsCenter = () =>
  useQuery({
    queryKey: requestsKey,
    queryFn: async () => {
      const response = await axiosInstance.get<RequestsCenterResponse>("/requests", {
        withCredentials: true,
      });
      return response.data;
    },
  });

export const useApproveUserRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, userTypeId }: { userId: number; userTypeId?: number | null }) => {
      const response = await axiosInstance.post<UserApprovalRequest>(
        `/requests/users/${userId}/approve`,
        { userTypeId },
        { withCredentials: true },
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKey });
    },
  });
};

export const useRejectUserRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, decisionNote }: { userId: number; decisionNote?: string | null }) => {
      const response = await axiosInstance.post<UserApprovalRequest>(
        `/requests/users/${userId}/reject`,
        { decisionNote },
        { withCredentials: true },
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKey });
    },
  });
};

export const useDecideScheduleSwapRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ swapId, approve, reason }: { swapId: number; approve: boolean; reason?: string | null }) => {
      const response = await axiosInstance.post<SwapRequest>(
        `/requests/shift-change-requests/${swapId}/decision`,
        { approve, reason },
        { withCredentials: true },
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKey });
      queryClient.invalidateQueries({ queryKey: ["scheduling"] });
      queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] });
    },
  });
};

export const useDecideFinanceRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      action,
      decisionNote,
    }: {
      requestId: number;
      action: "approve" | "return" | "reject";
      decisionNote?: string | null;
    }) => {
      const response = await axiosInstance.post<FinanceManagementRequest>(
        `/requests/finance/${requestId}/${action}`,
        { decisionNote },
        { withCredentials: true },
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKey });
    },
  });
};

export const useUpdatePopupRequestStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, status }: { requestId: number; status: boolean }) => {
      const response = await axiosInstance.patch(
        `/required-actions/actions/${requestId}/status`,
        { status },
        { withCredentials: true },
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKey });
      queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] });
    },
  });
};
