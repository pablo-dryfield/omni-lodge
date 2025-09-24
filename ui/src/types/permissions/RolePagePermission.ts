export type RolePagePermission = {
  id: number;
  userTypeId: number;
  pageId: number;
  canView: boolean;
  status: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: number | null;
  updatedBy?: number | null;
};
