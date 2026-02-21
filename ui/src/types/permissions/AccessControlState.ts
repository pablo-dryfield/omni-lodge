export type AccessControlState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pages: string[];
  modules: Record<string, string[]>;
  openBarModeAccess: {
    canUseBartenderMode: boolean;
    canUseManagerMode: boolean;
    shiftRoleSlugs: string[];
    userTypeSlug: string | null;
  } | null;
};
