import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type RequiredActionField = {
  key: string;
  label: string;
  inputType: "text" | "date" | "email" | "tel" | "textarea" | "image";
  currentValue?: string | null;
};

export type RequiredActionItem = {
  id: string;
  source: "required_action" | "schedule_swap";
  recordId: number;
  type:
    | "broadcast"
    | "policy_consent"
    | "profile_fields"
    | "quiz"
    | "assistant_manager_task"
    | "custom"
    | "schedule_swap_partner"
    | "schedule_swap_manager";
  title: string;
  body?: string | null;
  blocking: boolean;
  requiresSignature?: boolean;
  dueAt?: string | null;
  payload: Record<string, unknown> & {
    fields?: RequiredActionField[];
    cerebroEntry?: {
      id: number;
      title: string;
      summary?: string | null;
      body: string;
      policyVersion?: string | null;
      requiredVersion: string;
      estimatedReadMinutes?: number | null;
    };
    cerebroQuiz?: {
      id: number;
      title: string;
      description?: string | null;
      passingScore: number;
      questions: Array<{
        id: string;
        prompt: string;
        options: Array<{ id: string; label: string }>;
      }>;
    };
  };
};

export type RequiredActionsResponse = {
  actions: RequiredActionItem[];
  summary: {
    total: number;
    blocking: number;
  };
};

const requiredActionsKey = ["required-actions", "me"] as const;

export type CreateRequiredActionPayload = {
  type: "broadcast" | "policy_consent" | "profile_fields" | "quiz" | "assistant_manager_task" | "custom";
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  targetUserIds?: number[] | null;
  targetUserTypeIds?: number[] | null;
  targetShiftRoleIds?: number[] | null;
  targetStaffProfileTypes?: string[] | null;
  requiresCompletion?: boolean;
  requiresSignature?: boolean;
  startsAt?: string | null;
  dueAt?: string | null;
  expiresAt?: string | null;
  status?: boolean;
};

export const useMyRequiredActions = (enabled: boolean) =>
  useQuery({
    queryKey: requiredActionsKey,
    queryFn: async () => {
      const response = await axiosInstance.get<RequiredActionsResponse>("/required-actions/me", {
        withCredentials: true,
      });
      return response.data;
    },
    enabled,
    refetchInterval: enabled ? 30000 : false,
    refetchOnWindowFocus: true,
  });

export const useCompleteRequiredAction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, response }: { actionId: number; response?: Record<string, unknown> }) => {
      await axiosInstance.post(
        `/required-actions/actions/${actionId}/complete`,
        { response: response ?? {} },
        { withCredentials: true },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requiredActionsKey });
    },
  });
};

export const useMarkRequiredActionPrompted = () =>
  useMutation({
    mutationFn: async ({ actionId }: { actionId: number }) => {
      await axiosInstance.post(`/required-actions/actions/${actionId}/prompted`, {}, { withCredentials: true });
    },
  });

export const useCompleteRequiredProfileFields = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      actionId,
      values,
      profilePhoto,
      signature,
    }: {
      actionId: number;
      values: Record<string, string>;
      profilePhoto?: File | null;
      signature?: Record<string, unknown> | null;
    }) => {
      const valuesWithSignature = signature ? { ...values, __signature: signature } : values;
      if (profilePhoto) {
        const formData = new FormData();
        formData.append("values", JSON.stringify(valuesWithSignature));
        formData.append("profilePhoto", profilePhoto);
        await axiosInstance.post(`/required-actions/actions/${actionId}/profile-fields`, formData, {
          withCredentials: true,
          headers: { "Content-Type": "multipart/form-data" },
        });
        return;
      }

      await axiosInstance.post(`/required-actions/actions/${actionId}/profile-fields`, { values: valuesWithSignature }, { withCredentials: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requiredActionsKey });
    },
  });
};

export const useRespondToRequiredSwap = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ swapId, accept }: { swapId: number; accept: boolean }) => {
      await axiosInstance.post(
        `/required-actions/schedule-swaps/${swapId}/partner-response`,
        { accept },
        { withCredentials: true },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requiredActionsKey });
    },
  });
};

export const useDecideRequiredManagerSwap = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ swapId, approve }: { swapId: number; approve: boolean }) => {
      await axiosInstance.post(
        `/required-actions/schedule-swaps/${swapId}/manager-decision`,
        { approve },
        { withCredentials: true },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requiredActionsKey });
    },
  });
};

export const useCreateRequiredAction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateRequiredActionPayload) => {
      const response = await axiosInstance.post("/required-actions/actions", payload, {
        withCredentials: true,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requiredActionsKey });
    },
  });
};
