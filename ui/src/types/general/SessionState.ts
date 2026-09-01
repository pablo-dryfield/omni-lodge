export type SessionState = {
  user: string;
  authenticated: boolean;
  checkingSession: boolean;
  loggedUserId: number;
  roleSlug?: string | null;
  roleName?: string | null;
  userTypeId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  hasStoredProfilePhoto: boolean;
  profilePhotoVersion?: string | null;
  notificationInboxPollingEnabled: boolean;
  badgeCampaignBaseUrl: string | null;
  error: string | null;
};

export type SessionResponse = {
  authenticated: boolean;
  userId: number;
  firstName?: string | null;
  lastName?: string | null;
  roleSlug?: string | null;
  roleName?: string | null;
  userTypeId?: number | null;
  hasStoredProfilePhoto?: boolean;
  profilePhotoVersion?: string | null;
  notificationInboxPollingEnabled?: boolean;
  badgeCampaignBaseUrl?: string | null;
};
