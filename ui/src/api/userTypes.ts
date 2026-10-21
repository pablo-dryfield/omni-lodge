import axiosInstance from "../utils/axiosInstance";
import type { UserType } from "../types/userTypes/UserType";

export const createFoodTourUserType = async (payload: { name: string; description: string; sourceUserTypeId: number }): Promise<Partial<UserType>> => {
  const response = await axiosInstance.post<[Partial<UserType>]>("/userTypes", payload);
  if (!response.data[0]) throw new Error("The server did not return the saved user type");
  return response.data[0];
};

export type UserTypePermissionAction = "add_all" | "remove_all" | "copy_from";

export const applyUserTypePermissions = async (params: {
  userTypeId: number;
  action: UserTypePermissionAction;
  sourceUserTypeId?: number | null;
}): Promise<{ message: string; pagesApplied: number; modulePermissionsApplied: number }> => {
  const { userTypeId, action, sourceUserTypeId } = params;
  const response = await axiosInstance.post(`/userTypes/${userTypeId}/permissions`, {
    action,
    sourceUserTypeId: sourceUserTypeId ?? undefined,
  });
  return response.data as {
    message: string;
    pagesApplied: number;
    modulePermissionsApplied: number;
  };
};
