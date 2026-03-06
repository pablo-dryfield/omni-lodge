export type SessionState = {
  user: string;
  authenticated: boolean;
  checkingSession: boolean;
  loggedUserId: number;
  roleSlug?: string | null;
  roleName?: string | null;
  userTypeId?: number | null;
  error: string | null;
};
