import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useEffect, useState } from "react";
import axiosInstance from "../utils/axiosInstance";

export type CleaningPhotoStatus = "missing" | "pending" | "approved" | "rejected";
export type CleaningPhotoVersion = {
  id: number;
  version: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  rejectionReason: string | null;
  photoUrl: string;
  status: Exclude<CleaningPhotoStatus, "missing">;
};
export type CleaningPhotoSlot = {
  key: string;
  label: string;
  ruleKey: string;
  status: CleaningPhotoStatus;
  currentVersion: CleaningPhotoVersion | null;
  history: CleaningPhotoVersion[];
};
export type CleaningSubmission = {
  id: number;
  taskLogId: number;
  shiftAssignmentId: number | null;
  userId: number;
  subjectName?: string;
  taskDate: string;
  title: string;
  shiftName: string;
  status: string;
  revision: number;
  reviewerMissing: boolean;
  canUpload: boolean;
  canReview: boolean;
  escalationReason?: string | null;
  slots: CleaningPhotoSlot[];
};
type CleaningResponse = { submission: CleaningSubmission; taskCompleted?: boolean };
export type CleaningTaskIssue = {
  taskLogId: number;
  taskDate: string;
  title: string;
  code: string;
  message: string;
  canWaive: boolean;
  updatedAt: string;
};
export type MyCleaningSubmissions = {
  submissions: CleaningSubmission[];
  reviewSubmissions: CleaningSubmission[];
  taskIssues: CleaningTaskIssue[];
};
type CleaningError = AxiosError<{ message?: string; error?: string } | Array<{ message?: string }>>;

export const cleaningKeys = {
  all: ["volunteer-cleaning"] as const,
  mine: (userId: number) => ["volunteer-cleaning", "me", userId] as const,
  detail: (id: number, userId: number) => ["volunteer-cleaning", "detail", id, userId] as const,
};

export const getCleaningError = (error: unknown, fallback = "Unable to load cleaning tasks."): string => {
  const candidate = error as CleaningError | undefined;
  const data = candidate?.response?.data;
  const body = Array.isArray(data) ? data[0] : data;
  if (typeof body?.message === "string" && body.message) return body.message;
  return body && "error" in body && typeof body.error === "string" && body.error ? body.error : fallback;
};

// Cached drafts may survive a temporary refresh failure, but not an
// authoritative denial or a response saying the resource no longer exists.
export const isTransientCleaningQueryError = (error: unknown): boolean => {
  if (!error) return false;
  const status = (error as CleaningError).response?.status;
  return status == null || status === 0 || status === 408 || status === 429 || status >= 500;
};

export const useCleaningCachedDataBlocked = (error: unknown, isSuccess: boolean): boolean => {
  const [previouslyDenied, setPreviouslyDenied] = useState(false);
  const denied = Boolean(error && !isTransientCleaningQueryError(error));
  useEffect(() => {
    if (denied) setPreviouslyDenied(true);
    else if (!error && isSuccess) setPreviouslyDenied(false);
  }, [denied, error, isSuccess]);
  // A transient retry after a denial does not reauthorize old cached data.
  return denied || (previouslyDenied && !(isSuccess && !error));
};

export const fetchMyCleaningSubmissions = async (): Promise<MyCleaningSubmissions> => {
  const response = await axiosInstance.get<MyCleaningSubmissions>("/cleaningSubmissions/me");
  return response.data;
};
export const fetchCleaningSubmission = async (id: number): Promise<CleaningSubmission> => {
  const response = await axiosInstance.get<CleaningResponse>(`/cleaningSubmissions/${id}`);
  return response.data.submission;
};
export const fetchCleaningPhoto = async (submissionId: number, photoId: number, signal?: AbortSignal): Promise<Blob> => {
  const response = await axiosInstance.get<Blob>(`/cleaningSubmissions/${submissionId}/photos/${photoId}`, { responseType: "blob", signal });
  return response.data;
};
export const useMyCleaningSubmissions = (enabled: boolean, userId: number) => useQuery({
  queryKey: cleaningKeys.mine(userId),
  queryFn: fetchMyCleaningSubmissions,
  enabled: enabled && userId > 0,
  retry: false,
  staleTime: 30_000,
});
export const useCleaningSubmission = (id: number, userId: number, enabled = true) => useQuery({
  queryKey: cleaningKeys.detail(id, userId),
  queryFn: () => fetchCleaningSubmission(id),
  enabled: enabled && Number.isInteger(id) && id > 0 && userId > 0,
  retry: false,
  staleTime: 15_000,
});

export const uploadCleaningPhoto = async ({
  submissionId, slotKey, expectedRevision, file,
}: { submissionId: number; slotKey: string; expectedRevision: number; file: File }): Promise<CleaningResponse> => {
  const form = new FormData();
  form.append("file", file);
  form.append("expectedRevision", String(expectedRevision));
  const response = await axiosInstance.post<CleaningResponse>(
    `/cleaningSubmissions/${submissionId}/slots/${encodeURIComponent(slotKey)}/photos`, form,
  );
  return response.data;
};
export const reviewCleaningPhoto = async ({
  submissionId, photoId, ...body
}: { submissionId: number; photoId: number; expectedRevision: number; decision: "approved" | "rejected"; reason?: string; escalationReason?: string }): Promise<CleaningResponse> => {
  const response = await axiosInstance.patch<CleaningResponse>(`/cleaningSubmissions/${submissionId}/photos/${photoId}/review`, body);
  return response.data;
};
export const waiveCanceledCleaningTask = async ({
  taskLogId, ...body
}: { taskLogId: number; reason: string; expectedUpdatedAt: string }): Promise<{ taskLogId: number; status: "waived" }> => {
  const response = await axiosInstance.post<{ taskLogId: number; status: "waived" }>(`/cleaningSubmissions/tasks/${taskLogId}/waive`, body);
  return response.data;
};

const useCleaningInvalidation = (userId: number) => {
  const queryClient = useQueryClient();
  return async (result?: CleaningResponse) => {
    if (result) queryClient.setQueryData(cleaningKeys.detail(result.submission.id, userId), result.submission);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cleaningKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] }),
      queryClient.invalidateQueries({ queryKey: ["volunteer-milestones"] }),
    ]);
  };
};
export const useUploadCleaningPhoto = (userId: number) => {
  const invalidate = useCleaningInvalidation(userId);
  return useMutation({ mutationFn: uploadCleaningPhoto, onSuccess: invalidate,
    onError: async (error: CleaningError) => { if (error.response?.status === 409) await invalidate(); } });
};
export const useReviewCleaningPhoto = (userId: number) => {
  const invalidate = useCleaningInvalidation(userId);
  return useMutation({ mutationFn: reviewCleaningPhoto, onSuccess: invalidate,
    onError: async (error: CleaningError) => { if (error.response?.status === 409) await invalidate(); } });
};
export const useWaiveCanceledCleaningTask = (userId: number) => {
  const invalidate = useCleaningInvalidation(userId);
  return useMutation({ mutationFn: waiveCanceledCleaningTask, onSuccess: async () => { await invalidate(); },
    onError: async (error: CleaningError) => { if (error.response?.status === 409) await invalidate(); } });
};
