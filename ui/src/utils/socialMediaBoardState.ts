import {
  SOCIAL_MEDIA_CONTENT_STATUSES,
  type SocialMediaContentStatus,
} from "../types/socialMedia";

export type SocialMediaBoardStatusFilter = SocialMediaContentStatus | "all";
export type SocialMediaEditorSelection = "new" | number | null;

export type SocialMediaBoardUrlState = {
  search: string;
  status: SocialMediaBoardStatusFilter;
  platform: string;
  editor: SocialMediaEditorSelection;
};

export type SocialMediaEditorDraftValues = {
  title: string;
  idea: string;
  onVideoCaptions: string;
  platformCaption: string;
  hashtags: string[];
  targetPlatforms: string[];
  status: SocialMediaContentStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  driveProjectUrl: string;
  platformLinks: Record<string, string>;
  thumbnailUrl: string;
};

export type StoredSocialMediaEditorDraft = {
  version: 1;
  editor: Exclude<SocialMediaEditorSelection, null>;
  values: SocialMediaEditorDraftValues;
  savedAt: string;
};

export const SOCIAL_MEDIA_EDITOR_DRAFT_STORAGE_KEY = "omni.socialMedia.editorDraft.v1";

export const buildSocialMediaEditorDraftStorageKey = (
  userId: number | string | null | undefined,
): string => {
  const normalizedUserId = String(userId ?? "").trim();
  return normalizedUserId
    ? `${SOCIAL_MEDIA_EDITOR_DRAFT_STORAGE_KEY}.${normalizedUserId}`
    : SOCIAL_MEDIA_EDITOR_DRAFT_STORAGE_KEY;
};

const isStatus = (value: unknown): value is SocialMediaContentStatus =>
  typeof value === "string"
  && (SOCIAL_MEDIA_CONTENT_STATUSES as readonly string[]).includes(value);

const normalizeEditor = (value: string | null): SocialMediaEditorSelection => {
  if (value === "new") return "new";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const parseSocialMediaBoardUrlState = (
  params: URLSearchParams,
): SocialMediaBoardUrlState => {
  const rawStatus = params.get("status");
  return {
    search: (params.get("search") ?? "").trim(),
    status: isStatus(rawStatus) ? rawStatus : "all",
    platform: (params.get("platform") ?? "").trim().toLowerCase(),
    editor: normalizeEditor(params.get("editor")),
  };
};

export const writeSocialMediaBoardUrlState = (
  current: URLSearchParams,
  state: SocialMediaBoardUrlState,
): URLSearchParams => {
  const next = new URLSearchParams(current);
  const setOptional = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  setOptional("search", state.search.trim() || null);
  setOptional("status", state.status === "all" ? null : state.status);
  setOptional("platform", state.platform.trim().toLowerCase() || null);
  setOptional("editor", state.editor === null ? null : String(state.editor));
  return next;
};

export const resolveEditorAfterMediaFailure = (
  editor: Exclude<SocialMediaEditorSelection, null>,
  savedId: number,
): number => editor === "new" ? savedId : editor;

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean)))
    : [];

const normalizeOptionalIso = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizePlatformLinks = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (links, [platform, url]) => {
      const normalizedPlatform = platform.trim().toLowerCase();
      const normalizedUrl = typeof url === "string" ? url.trim() : "";
      if (normalizedPlatform && normalizedUrl) links[normalizedPlatform] = normalizedUrl;
      return links;
    },
    {},
  );
};

export const parseStoredSocialMediaEditorDraft = (
  raw: string | null,
): StoredSocialMediaEditorDraft | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const editor = value.editor === "new"
      ? "new"
      : Number.isSafeInteger(Number(value.editor)) && Number(value.editor) > 0
        ? Number(value.editor)
        : null;
    const source = value.values && typeof value.values === "object" && !Array.isArray(value.values)
      ? (value.values as Record<string, unknown>)
      : null;
    if (value.version !== 1 || editor === null || !source || !isStatus(source.status)) {
      return null;
    }
    return {
      version: 1,
      editor,
      values: {
        title: String(source.title ?? ""),
        idea: String(source.idea ?? ""),
        onVideoCaptions: String(source.onVideoCaptions ?? ""),
        platformCaption: String(source.platformCaption ?? ""),
        hashtags: normalizeHashtags(normalizeStringArray(source.hashtags)),
        targetPlatforms: normalizeStringArray(source.targetPlatforms),
        status: source.status,
        scheduledAt: normalizeOptionalIso(source.scheduledAt),
        publishedAt: normalizeOptionalIso(source.publishedAt),
        driveProjectUrl: String(source.driveProjectUrl ?? source.driveUrl ?? ""),
        platformLinks: normalizePlatformLinks(source.platformLinks),
        thumbnailUrl: String(source.thumbnailUrl ?? ""),
      },
      savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    };
  } catch {
    return null;
  }
};

export const normalizeHashtags = (values: readonly string[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => value.trim().replace(/^#+/, ""))
        .filter(Boolean),
    ),
  );
