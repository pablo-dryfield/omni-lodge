import axiosInstance from "./axiosInstance";
import type { User } from "../types/users/User";

type BuildProfilePhotoUrlParams = {
  user?: Partial<User> | null;
  cacheOverride?: number;
};

const cleanBaseUrl = (value?: string) => {
  if (!value) {
    return null;
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

export const buildUserProfilePhotoUrl = ({ user, cacheOverride }: BuildProfilePhotoUrlParams): string | null => {
  if (!user || !user.id) {
    return null;
  }

  const trimmedExisting = user.profilePhotoUrl?.trim();
  const hasStoredPath = typeof user.profilePhotoPath === "string" && user.profilePhotoPath.trim().length > 0;
  const baseUrl = cleanBaseUrl(axiosInstance.defaults.baseURL);

  if (hasStoredPath && baseUrl) {
    const updatedAtValue = user.updatedAt ? new Date(user.updatedAt) : null;
    const cacheToken = cacheOverride ?? (updatedAtValue ? updatedAtValue.getTime() : Date.now());
    const url = `${baseUrl}/users/${user.id}/profile-photo`;
    return cacheToken ? `${url}?v=${cacheToken}` : url;
  }

  if (trimmedExisting && trimmedExisting.length > 0) {
    return trimmedExisting;
  }

  return null;
};
