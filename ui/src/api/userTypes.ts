import axiosInstance from "../utils/axiosInstance";

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
