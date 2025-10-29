export interface UserShiftRoleAssignment extends Record<string, unknown> {
  userId: number;
  firstName: string;
  lastName: string;
  roleIds: number[];
}
