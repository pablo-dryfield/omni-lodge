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

export const canAccessSocialMediaEditor = (
  editor: SocialMediaEditorSelection,
  permissions: { canCreate: boolean; canUpdate: boolean },
): boolean => {
  if (editor === null) return false;
  return editor === "new" ? permissions.canCreate : permissions.canUpdate;
};

const normalizeStringArray = (value: unknown): string[] => {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/u)
      : [];
  return Array.from(new Set(entries.map((entry) => String(entry ?? "").trim()).filter(Boolean)));
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const isValidDateOnly = (value: string): boolean => {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

/** Converts picker values and legacy ISO timestamps to the API's date-only value. */
export const toSocialMediaDateOnly = (
  value: unknown,
): string | null => {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value !== "string") return null;
  const candidate = value.trim().slice(0, 10);
  return isValidDateOnly(candidate) ? candidate : null;
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
    // The first workflow UI wrote versionless drafts and string editor ids. Keep
    // those recoverable while rejecting unknown future schemas.
    const supportedVersion = value.version == null || value.version === 1 || value.version === "1";
    if (!supportedVersion || editor === null || !source) {
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
      },
      savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    };
  } catch {
    return null;
  }
};

export const serializeSocialMediaEditorDraft = (
  editor: Exclude<SocialMediaEditorSelection, null>,
  values: SocialMediaEditorDraftValues,
  savedAt = new Date().toISOString(),
): string => JSON.stringify({
  version: 1,
  editor,
  values: {
    title: String(values.title ?? ""),
    idea: String(values.idea ?? ""),
    onVideoCaptions: String(values.onVideoCaptions ?? ""),
    platformCaption: String(values.platformCaption ?? ""),
    hashtags: normalizeHashtags(values.hashtags),
  },
  savedAt,
} satisfies StoredSocialMediaEditorDraft);

const normalizeHashtag = (value: string): string =>
  value.trim().replace(/^#+/u, "").trim().toLowerCase();

/** Stores tags without `#` and removes duplicates regardless of casing. */
export const normalizeHashtags = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.reduce<string[]>((result, value) => {
    const normalized = normalizeHashtag(value);
    if (!normalized || seen.has(normalized)) return result;
    seen.add(normalized);
    result.push(normalized);
    return result;
  }, []);
};

/** Presents a normalized tag with exactly one leading hash. */
export const formatHashtag = (value: string): string => {
  const normalized = normalizeHashtag(value);
  return normalized ? `#${normalized}` : "";
};
