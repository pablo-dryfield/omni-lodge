import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";
import type { ServerResponse } from "../types/general/ServerResponse";
import type { ShiftRole } from "../types/shiftRoles/ShiftRole";
import type { UserShiftRoleAssignment } from "../types/shiftRoles/UserShiftRoleAssignment";

const shiftRolesKey = ["shift-roles"] as const;
const shiftRoleAssignmentsKey = ["shift-role-assignments"] as const;

export const useShiftRoles = () =>
  useQuery({
    queryKey: shiftRolesKey,
    queryFn: async () => {
      const response = await axiosInstance.get("/shiftRoles");
      return response.data as ServerResponse<ShiftRole>;
    },
  });

export const useCreateShiftRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; slug?: string }) => {
      const response = await axiosInstance.post("/shiftRoles", payload);
      return response.data as ShiftRole[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftRolesKey });
    },
  });
};

export const useUpdateShiftRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ShiftRole> }) => {
      const response = await axiosInstance.patch(`/shiftRoles/${id}`, data);
      return response.data as ShiftRole[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftRolesKey });
    },
  });
};

export const useDeleteShiftRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await axiosInstance.delete(`/shiftRoles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftRolesKey });
      queryClient.invalidateQueries({ queryKey: shiftRoleAssignmentsKey });
    },
  });
};

export const useShiftRoleAssignments = () =>
  useQuery({
    queryKey: shiftRoleAssignmentsKey,
    queryFn: async () => {
      const response = await axiosInstance.get("/shiftRoles/assignments");
      return response.data as ServerResponse<UserShiftRoleAssignment>;
    },
  });

export const useUpdateUserShiftRoles = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, roleIds }: { userId: number; roleIds: number[] }) => {
      const response = await axiosInstance.put(`/shiftRoles/assignments/${userId}`, { roleIds });
      return response.data as Array<{ userId: number; roleIds: number[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftRoleAssignmentsKey });
    },
  });
};

