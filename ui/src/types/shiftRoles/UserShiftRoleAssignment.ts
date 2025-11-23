export interface UserShiftRoleAssignment extends Record<string, unknown> {
  userId: number;
  firstName: string;
  lastName: string;
  roleIds: number[];
  livesInAccom?: boolean;
  staffProfileActive?: boolean;
  roles?: Array<{
    id: number;
    name: string;
  }>;
}
