import { useMutation, useQuery } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type GoogleCredentialKey = "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REFRESH_TOKEN";

export type GoogleApiAccessStatus = {
  configured: Record<GoogleCredentialKey, boolean>;
  missingKeys: GoogleCredentialKey[];
  scopes: string[];
  rawScope: string | null;
  refreshedAt: string;
  expiresAt: string | null;
  audience: string | null;
};

export type GoogleOAuthScopeCatalogEntry = {
  api: string;
  version: string | null;
  scope: string;
  description: string;
  documentationUrl: string | null;
};

export type GoogleOAuthScopeCatalog = {
  scopes: GoogleOAuthScopeCatalogEntry[];
  sourceUrl: string;
  fetchedAt: string;
};

export type GoogleOAuthAuthorizationStart = {
  authorizationUrl: string;
  redirectUri: string;
  scopes: string[];
};

export const useGoogleApiAccess = () =>
  useQuery<GoogleApiAccessStatus, unknown>({
    queryKey: ["google-api", "access"],
    queryFn: async () => {
      const response = await axiosInstance.get("/google-api/access");
      return response.data.access as GoogleApiAccessStatus;
    },
  });

export const useGoogleOAuthScopeCatalog = () =>
  useQuery<GoogleOAuthScopeCatalog, unknown>({
    queryKey: ["google-api", "scopes"],
    queryFn: async () => {
      const response = await axiosInstance.get("/google-api/scopes");
      return response.data.catalog as GoogleOAuthScopeCatalog;
    },
    staleTime: 6 * 60 * 60 * 1000,
  });

export const useStartGoogleOAuthAuthorization = () =>
  useMutation<GoogleOAuthAuthorizationStart, unknown, { scopes: string[]; returnUrl: string }>({
    mutationFn: async ({ scopes, returnUrl }) => {
      const response = await axiosInstance.post("/google-api/oauth/authorize", { scopes, returnUrl });
      return response.data as GoogleOAuthAuthorizationStart;
    },
  });
