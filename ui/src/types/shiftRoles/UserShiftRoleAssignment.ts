export interface UserShiftRoleAssignment extends Record<string, unknown> {
  userId: number;
  firstName: string;
  lastName: string;
  roleIds: number[];
  userStatus?: boolean;
  livesInAccom?: boolean;
  staffProfileActive?: boolean;
  staffType?: string | null;
  arrivalDate?: string | null;
  departureDate?: string | null;
  roles?: Array<{
    id: number;
    name: string;
  }>;
}
