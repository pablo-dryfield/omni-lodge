import axiosInstance from "./axiosInstance";

export const resolvePhotoDownloadUrl = (downloadUrl: string): string => {
  const base =
    axiosInstance.defaults.baseURL || (typeof window !== "undefined" ? window.location.origin : "");
  if (base) {
    try {
      return new URL(downloadUrl, base).toString();
    } catch {
      // Ignore parsing issues and return the original value
    }
  }
  return downloadUrl;
};

export type NightReportPhotoPreview = {
  src: string;
  name: string;
  capturedAt: string | null;
  downloadHref?: string;
};
