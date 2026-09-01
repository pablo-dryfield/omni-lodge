import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";
import {
  SOCIAL_MEDIA_CONTENT_STATUSES,
  type SocialMediaContentStatus,
} from "../types/socialMedia";

export { SOCIAL_MEDIA_CONTENT_STATUSES } from "../types/socialMedia";
export type { SocialMediaContentStatus } from "../types/socialMedia";

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
  createdBy: number | null;
  updatedBy: number | null;
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

export type SocialMediaContentPayload = {
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
  return useMutation<SocialMediaContentItem, ApiError, SocialMediaContentPayload>({
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
    { id: number; changes: Partial<SocialMediaContentPayload> }
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
