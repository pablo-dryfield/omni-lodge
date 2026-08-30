import axiosInstance from "./axiosInstance";

type ProfilePhotoUser = {
  id?: number | null;
  profilePhotoPath?: string | null;
  profilePhotoUrl?: string | null;
  hasStoredProfilePhoto?: boolean;
  updatedAt?: Date | string | null;
};

type BuildProfilePhotoUrlParams = {
  user?: ProfilePhotoUser | null;
  cacheOverride?: number | string;
  resourcePath?: string;
};

const cleanBaseUrl = (value?: string) => {
  if (!value) {
    return null;
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

export const buildUserProfilePhotoUrl = ({
  user,
  cacheOverride,
  resourcePath,
}: BuildProfilePhotoUrlParams): string | null => {
  if (!user || !user.id) {
    return null;
  }

  const trimmedExisting = user.profilePhotoUrl?.trim();
  const hasStoredPath = user.hasStoredProfilePhoto === true
    || (typeof user.profilePhotoPath === "string" && user.profilePhotoPath.trim().length > 0);
  const baseUrl = cleanBaseUrl(axiosInstance.defaults.baseURL);

  if (hasStoredPath && baseUrl) {
    const updatedAtValue = user.updatedAt ? new Date(user.updatedAt) : null;
    const cacheToken = cacheOverride ?? (updatedAtValue ? updatedAtValue.getTime() : Date.now());
    const normalizedResourcePath = resourcePath?.trim();
    const url = normalizedResourcePath
      ? `${baseUrl}${normalizedResourcePath.startsWith("/") ? "" : "/"}${normalizedResourcePath}`
      : `${baseUrl}/users/${user.id}/profile-photo`;
    return cacheToken ? `${url}?v=${cacheToken}` : url;
  }

  if (trimmedExisting && trimmedExisting.length > 0) {
    return trimmedExisting;
  }

  return null;
};
