export type StaffProfile = {
  userId: number;
  staffType: "volunteer" | "long_term";
  livesInAccom: boolean;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  userName?: string | null;
  userEmail?: string | null;
  userStatus?: boolean | null;
};
