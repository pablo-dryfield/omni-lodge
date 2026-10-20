export type AccessSnapshot = {
  productTypeIds?: number[] | null;
  pages: string[];
  modules: Record<string, string[]>;
  openBarModeAccess?: {
    canUseBartenderMode: boolean;
    canUseManagerMode: boolean;
    shiftRoleSlugs: string[];
    userTypeSlug: string | null;
  };
};
