export type RoleModulePermission = {
  id: number;
  userTypeId: number;
  moduleId: number;
  actionId: number;
  allowed: boolean;
  status: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: number | null;
  updatedBy?: number | null;
};
