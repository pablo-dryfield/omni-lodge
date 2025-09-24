export type AccessControlState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pages: string[];
  modules: Record<string, string[]>;
};
