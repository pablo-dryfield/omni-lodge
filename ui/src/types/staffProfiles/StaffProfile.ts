export type StaffProfile = {
  userId: number;
  staffType: "volunteer" | "long_term";
  livesInAccom: boolean;
  active: boolean;
  financeVendorId: number | null;
  financeClientId: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  userName?: string | null;
  userEmail?: string | null;
  userStatus?: boolean | null;
  financeVendorName?: string | null;
  financeClientName?: string | null;
};
