import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";
import { uploadFileToResumableDriveSession } from "../utils/resumableDriveUpload";
import type {
  SocialMediaAssetKind,
  SocialMediaContentAsset,
  SocialMediaContentStatus,
  SocialMediaTaskCompletion,
} from "../types/socialMedia";

export {
  SOCIAL_MEDIA_ASSET_KINDS,
  SOCIAL_MEDIA_CONTENT_STATUSES,
} from "../types/socialMedia";
export type {
  SocialMediaAssetKind,
  SocialMediaContentAsset,
  SocialMediaContentStatus,
  SocialMediaTaskCompletion,
} from "../types/socialMedia";

export type SocialMediaContentItem = {
  id: number;
  title: string;
  idea: string;
  onVideoCaptions: string;
  platformCaption: string;
  hashtags: string[];
  targetPlatforms: string[];
  status: SocialMediaContentStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  driveProjectUrl: string | null;
  platformLinks: Record<string, string>;
  thumbnailUrl: string | null;
  assets: SocialMediaContentAsset[];
  productionStartedAt: string | null;
  readyAt: string | null;
  publishedBy: number | null;
  publishedTaskLogId: number | null;
  createdBy: number | null;
  createdByName: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SocialMediaContentSelectableItem = Pick<
  SocialMediaContentItem,
  "id" | "title" | "idea" | "status" | "targetPlatforms" | "thumbnailUrl" | "scheduledAt"
> & {
  isTaskReady: boolean;
};

export type SocialMediaContentCounts = Partial<Record<SocialMediaContentStatus, number>>;

export type SocialMediaContentListResponse = {
  items: SocialMediaContentItem[];
  counts: SocialMediaContentCounts;
  total: number;
};

export type SocialMediaContentListParams = {
  search?: string;
  status?: SocialMediaContentStatus;
  platform?: string;
  includeArchived?: boolean;
};

export type SocialMediaContentSelectableResponse = {
  items: SocialMediaContentSelectableItem[];
};

export type SocialMediaContentBriefPayload = {
  title: string;
  idea: string;
  onVideoCaptions: string;
  platformCaption: string;
  hashtags: string[];
};

export type CreateSocialMediaContentPayload = SocialMediaContentBriefPayload;
export type EditSocialMediaContentPayload = Partial<SocialMediaContentBriefPayload>;

/**
 * Backward-compatible name for callers that edit the idea brief. Workflow state
 * is intentionally changed through the dedicated transition mutations below.
 */
export type SocialMediaContentPayload = SocialMediaContentBriefPayload;

export type PlanSocialMediaContentPayload = {
  scheduledDate: string;
};

export type PublishSocialMediaContentPayload = {
  platformLinks: Record<string, string>;
};

export type SocialMediaPublishResult = {
  item: SocialMediaContentItem;
  taskCompletion: SocialMediaTaskCompletion | null;
};

export type SocialMediaAssetUploadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type UploadSocialMediaAssetInput = {
  id: number;
  assetType: SocialMediaAssetKind;
  file: File;
  onProgress?: (progress: SocialMediaAssetUploadProgress) => void;
};

type SocialMediaResumableSessionResponse = {
  uploadUrl: string;
  uploadToken: string;
  chunkSizeBytes: number;
};

type ItemResponse = { item: SocialMediaContentItem };
type ApiError = AxiosError<{ message?: string }>;

export const SOCIAL_MEDIA_CONTENT_QUERY_KEY = ["social-media", "content"] as const;

const normalizeListParams = (params: SocialMediaContentListParams): SocialMediaContentListParams => ({
  ...(params.search?.trim() ? { search: params.search.trim() } : {}),
  ...(params.status ? { status: params.status } : {}),
  ...(params.platform?.trim() ? { platform: params.platform.trim() } : {}),
  ...(params.includeArchived ? { includeArchived: true } : {}),
});

export const useSocialMediaContentList = (
  params: SocialMediaContentListParams,
  options?: { enabled?: boolean },
) => {
  const normalized = normalizeListParams(params);
  return useQuery<SocialMediaContentListResponse, ApiError>({
    queryKey: [...SOCIAL_MEDIA_CONTENT_QUERY_KEY, "list", normalized],
    queryFn: async () => {
      const response = await axiosInstance.get<SocialMediaContentListResponse>(
        "/social-media/content",
        { params: normalized },
      );
      return response.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 20 * 1000,
    refetchOnWindowFocus: false,
  });
};

export const useSocialMediaContent = (
  id: number | null,
  options?: { enabled?: boolean },
) => useQuery<SocialMediaContentItem, ApiError>({
  queryKey: [...SOCIAL_MEDIA_CONTENT_QUERY_KEY, "detail", id ?? "none"],
  queryFn: async () => {
    if (!id) throw new Error("Social media content id is required");
    const response = await axiosInstance.get<ItemResponse>(`/social-media/content/${id}`);
    return response.data.item;
  },
  enabled: Boolean(id) && (options?.enabled ?? true),
});

export const useSelectableSocialMediaContent = (
  params?: { search?: string },
  options?: { enabled?: boolean },
) => useQuery<SocialMediaContentSelectableResponse, ApiError>({
  queryKey: [
    ...SOCIAL_MEDIA_CONTENT_QUERY_KEY,
    "selectable",
    params?.search?.trim() ?? "",
  ],
  queryFn: async () => {
    const response = await axiosInstance.get<SocialMediaContentSelectableResponse>(
      "/social-media/content/selectable",
      {
        params: {
          ...(params?.search?.trim() ? { search: params.search.trim() } : {}),
        },
      },
    );
    return response.data;
  },
  enabled: options?.enabled ?? true,
  staleTime: 20 * 1000,
  refetchOnWindowFocus: false,
});

const useInvalidateSocialMediaContent = () => {
  const queryClient = useQueryClient();
  return async (item?: SocialMediaContentItem) => {
    if (item) {
      queryClient.setQueryData(
        [...SOCIAL_MEDIA_CONTENT_QUERY_KEY, "detail", item.id],
        item,
      );
    }
    await queryClient.invalidateQueries({ queryKey: SOCIAL_MEDIA_CONTENT_QUERY_KEY });
  };
};

export const useCreateSocialMediaContent = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, CreateSocialMediaContentPayload>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post<ItemResponse>("/social-media/content", payload);
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useUpdateSocialMediaContent = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<
    SocialMediaContentItem,
    ApiError,
    { id: number; changes: EditSocialMediaContentPayload }
  >({
    mutationFn: async ({ id, changes }) => {
      const response = await axiosInstance.patch<ItemResponse>(
        `/social-media/content/${id}`,
        changes,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const usePlanSocialMediaContent = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<
    SocialMediaContentItem,
    ApiError,
    { id: number; scheduledDate: string }
  >({
    mutationFn: async ({ id, scheduledDate }) => {
      const payload: PlanSocialMediaContentPayload = { scheduledDate };
      const response = await axiosInstance.post<ItemResponse>(
        `/social-media/content/${id}/plan`,
        payload,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useStartSocialMediaProduction = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, number>({
    mutationFn: async (id) => {
      const response = await axiosInstance.post<ItemResponse>(
        `/social-media/content/${id}/start-production`,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useCreateSocialMediaProjectFolder = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, number>({
    mutationFn: async (id) => {
      const response = await axiosInstance.post<ItemResponse>(
        `/social-media/content/${id}/project-folder`,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useUploadSocialMediaAsset = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, UploadSocialMediaAssetInput>({
    mutationFn: async ({ id, assetType, file, onProgress }) => {
      const mimeType = file.type || "application/octet-stream";
      const sessionResponse = await axiosInstance.post<SocialMediaResumableSessionResponse>(
        `/social-media/content/${id}/assets/resumable-session`,
        {
          assetType,
          originalName: file.name,
          mimeType,
          sizeBytes: file.size,
        },
      );
      const session = sessionResponse.data;
      const driveFile = await uploadFileToResumableDriveSession({
        uploadUrl: session.uploadUrl,
        file,
        chunkSizeBytes: session.chunkSizeBytes,
        onProgress: onProgress
          ? ({ loaded, total, percent }) => onProgress({ loaded, total, percent })
          : undefined,
      });

      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await axiosInstance.post<ItemResponse>(
            `/social-media/content/${id}/assets/resumable-complete`,
            {
              assetType,
              driveFileId: driveFile.id,
              uploadToken: session.uploadToken,
              originalName: file.name,
              mimeType,
              sizeBytes: file.size,
            },
          );
          return response.data.item;
        } catch (error) {
          lastError = error;
          const status = (error as ApiError).response?.status;
          if ((status != null && status < 500) || attempt === 2) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, 400 * (2 ** attempt)));
        }
      }
      throw lastError;
    },
    onSuccess: invalidate,
  });
};

export const useDeleteSocialMediaAsset = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<
    SocialMediaContentItem,
    ApiError,
    { id: number; assetId: number }
  >({
    mutationFn: async ({ id, assetId }) => {
      const response = await axiosInstance.delete<ItemResponse>(
        `/social-media/content/${id}/assets/${assetId}`,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useMarkSocialMediaReady = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, number>({
    mutationFn: async (id) => {
      const response = await axiosInstance.post<ItemResponse>(
        `/social-media/content/${id}/ready`,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const usePublishSocialMediaContent = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<
    SocialMediaPublishResult,
    ApiError,
    { id: number; platformLinks: Record<string, string> }
  >({
    mutationFn: async ({ id, platformLinks }) => {
      const payload: PublishSocialMediaContentPayload = { platformLinks };
      const response = await axiosInstance.post<SocialMediaPublishResult>(
        `/social-media/content/${id}/publish`,
        payload,
      );
      return response.data;
    },
    onSuccess: async ({ item }) => invalidate(item),
  });
};

export const useArchiveSocialMediaContent = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, number>({
    mutationFn: async (id) => {
      const response = await axiosInstance.delete<ItemResponse>(`/social-media/content/${id}`);
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useUploadSocialMediaThumbnail = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, { id: number; file: File }>({
    mutationFn: async ({ id, file }) => {
      const body = new FormData();
      body.append("thumbnail", file);
      const response = await axiosInstance.post<ItemResponse>(
        `/social-media/content/${id}/thumbnail`,
        body,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};

export const useRemoveSocialMediaThumbnail = () => {
  const invalidate = useInvalidateSocialMediaContent();
  return useMutation<SocialMediaContentItem, ApiError, number>({
    mutationFn: async (id) => {
      const response = await axiosInstance.delete<ItemResponse>(
        `/social-media/content/${id}/thumbnail`,
      );
      return response.data.item;
    },
    onSuccess: invalidate,
  });
};
