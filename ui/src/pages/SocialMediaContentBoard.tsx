import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  FileButton,
  Group,
  Image,
  Loader,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArchive,
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconClock,
  IconDotsVertical,
  IconExternalLink,
  IconLayoutKanban,
  IconLink,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import {
  SOCIAL_MEDIA_CONTENT_STATUSES,
  type SocialMediaContentItem,
  type SocialMediaContentPayload,
  type SocialMediaContentStatus,
  useArchiveSocialMediaContent,
  useCreateSocialMediaContent,
  useRemoveSocialMediaThumbnail,
  useSocialMediaContentList,
  useUpdateSocialMediaContent,
  useUploadSocialMediaThumbnail,
} from "../api/socialMedia";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  buildSocialMediaEditorDraftStorageKey,
  type SocialMediaBoardUrlState,
  type SocialMediaEditorDraftValues,
  normalizeHashtags,
  parseSocialMediaBoardUrlState,
  parseStoredSocialMediaEditorDraft,
  resolveEditorAfterMediaFailure,
  writeSocialMediaBoardUrlState,
} from "../utils/socialMediaBoardState";

const MODULE_SLUG = "social-media-content";

type StageDefinition = {
  value: SocialMediaContentStatus;
  label: string;
  color: string;
  icon: typeof IconClock;
};

const STAGES: StageDefinition[] = [
  { value: "idea", label: "Ideas", color: "gray", icon: IconLayoutKanban },
  { value: "planned", label: "Planned", color: "blue", icon: IconCalendar },
  { value: "in_production", label: "In production", color: "violet", icon: IconClock },
  { value: "ready", label: "Ready", color: "orange", icon: IconCheck },
  { value: "published", label: "Published", color: "teal", icon: IconExternalLink },
  { value: "archived", label: "Archived", color: "dark", icon: IconArchive },
];

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X" },
  { value: "linkedin", label: "LinkedIn" },
];

const STATUS_OPTIONS = STAGES.map(({ value, label }) => ({ value, label }));
const TASK_READY_STATUSES = new Set<SocialMediaContentStatus>([
  "planned",
  "in_production",
  "ready",
  "published",
]);

const EMPTY_EDITOR_VALUES: SocialMediaEditorDraftValues = {
  title: "",
  idea: "",
  onVideoCaptions: "",
  platformCaption: "",
  hashtags: [],
  targetPlatforms: [],
  status: "idea",
  scheduledAt: null,
  publishedAt: null,
  driveProjectUrl: "",
  platformLinks: {},
  thumbnailUrl: "",
};

const editorKey = (editor: SocialMediaBoardUrlState["editor"]): string | null =>
  editor === null ? null : String(editor);

const itemToEditorValues = (item: SocialMediaContentItem): SocialMediaEditorDraftValues => ({
  title: item.title,
  idea: item.idea,
  onVideoCaptions: item.onVideoCaptions,
  platformCaption: item.platformCaption,
  hashtags: normalizeHashtags(item.hashtags),
  targetPlatforms: item.targetPlatforms,
  status: item.status,
  scheduledAt: item.scheduledAt,
  publishedAt: item.publishedAt,
  driveProjectUrl: item.driveProjectUrl ?? "",
  platformLinks: item.platformLinks ?? {},
  thumbnailUrl: item.thumbnailUrl ?? "",
});

const toPayload = (
  values: SocialMediaEditorDraftValues,
  thumbnailUrlOverride?: string | null,
): SocialMediaContentPayload => ({
  title: values.title.trim(),
  idea: values.idea.trim(),
  onVideoCaptions: values.onVideoCaptions.trim(),
  platformCaption: values.platformCaption.trim(),
  hashtags: normalizeHashtags(values.hashtags),
  targetPlatforms: Array.from(new Set(values.targetPlatforms.map((value) => value.trim()).filter(Boolean))),
  status: values.status,
  scheduledAt: values.scheduledAt,
  publishedAt: values.publishedAt,
  driveProjectUrl: values.driveProjectUrl.trim() || null,
  platformLinks: Object.entries(values.platformLinks).reduce<Record<string, string>>(
    (links, [platform, url]) => {
      const normalizedUrl = url.trim();
      if (values.targetPlatforms.includes(platform) && normalizedUrl) {
        links[platform] = normalizedUrl;
      }
      return links;
    },
    {},
  ),
  thumbnailUrl: thumbnailUrlOverride === undefined
    ? values.thumbnailUrl.trim() || null
    : thumbnailUrlOverride,
});

const getErrorMessage = (error: unknown, fallback = "Something went wrong. Please try again."): string => {
  if (error && typeof error === "object") {
    const response = "response" in error
      ? (error as { response?: { data?: { message?: unknown } } }).response
      : undefined;
    if (typeof response?.data?.message === "string" && response.data.message.trim()) {
      return response.data.message;
    }
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return String((error as { message: string }).message);
    }
  }
  return fallback;
};

const formatDateTime = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
};

const toDate = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const platformLabel = (value: string): string =>
  PLATFORM_OPTIONS.find((option) => option.value === value.toLowerCase())?.label ?? value;

const isSafeHttpUrl = (value: string | null): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const SocialContentCard = ({
  item,
  canUpdate,
  canDelete,
  moving,
  onEdit,
  onMove,
  onArchive,
}: {
  item: SocialMediaContentItem;
  canUpdate: boolean;
  canDelete: boolean;
  moving: boolean;
  onEdit: () => void;
  onMove: (status: SocialMediaContentStatus) => void;
  onArchive: () => void;
}) => {
  const scheduledLabel = formatDateTime(item.scheduledAt);
  const publishedLabel = item.status === "published" || item.status === "archived"
    ? formatDateTime(item.publishedAt)
    : null;
  const publishedLinks = Object.entries(item.platformLinks ?? {}).filter(([, url]) => isSafeHttpUrl(url));
  const driveLink = isSafeHttpUrl(item.driveProjectUrl) ? item.driveProjectUrl : null;
  const displayedHashtags = normalizeHashtags(item.hashtags);

  return (
    <Paper
      withBorder
      radius="lg"
      p="sm"
      shadow="xs"
      style={{ borderColor: "var(--mantine-color-gray-3)", overflow: "hidden" }}
    >
      <Stack gap="sm">
        {item.thumbnailUrl ? (
          <Image
            src={item.thumbnailUrl}
            alt={`${item.title} thumbnail`}
            h={142}
            radius="md"
            fit="cover"
            fallbackSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23eef1f4'/%3E%3C/svg%3E"
          />
        ) : null}

        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={750} lineClamp={2}>{item.title}</Text>
            {item.idea ? (
              <Text size="sm" c="dimmed" lineClamp={2} mt={3}>{item.idea}</Text>
            ) : null}
          </Box>
          {(canUpdate || canDelete) ? (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${item.title}`}>
                  <IconDotsVertical size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {canUpdate ? <Menu.Item onClick={onEdit}>Edit content</Menu.Item> : null}
                {canDelete && item.status !== "archived" ? (
                  <Menu.Item color="red" leftSection={<IconArchive size={15} />} onClick={onArchive}>
                    Archive
                  </Menu.Item>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </Group>

        {item.targetPlatforms.length > 0 ? (
          <Group gap={5}>
            {item.targetPlatforms.slice(0, 3).map((platform) => (
              <Badge key={platform} size="sm" variant="light" color="violet">
                {platformLabel(platform)}
              </Badge>
            ))}
            {item.targetPlatforms.length > 3 ? (
              <Badge size="sm" variant="light" color="gray">+{item.targetPlatforms.length - 3}</Badge>
            ) : null}
          </Group>
        ) : null}

        {displayedHashtags.length > 0 ? (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {displayedHashtags.slice(0, 4).map((tag) => `#${tag}`).join(" ")}
          </Text>
        ) : null}

        {(scheduledLabel || publishedLabel) ? (
          <Group gap={6} wrap="nowrap">
            <IconCalendar size={15} color="var(--mantine-color-gray-6)" />
            <Text size="xs" c="dimmed" lineClamp={1}>
              {publishedLabel ? `Published ${publishedLabel}` : `Scheduled ${scheduledLabel}`}
            </Text>
          </Group>
        ) : null}

        <Group justify="space-between" gap="xs" wrap="nowrap">
          {canUpdate && item.status !== "archived" ? (
            <Select
              aria-label={`Move ${item.title}`}
              size="xs"
              value={item.status}
              data={STATUS_OPTIONS.filter((option) => option.value !== "archived")}
              onChange={(value) => value && onMove(value as SocialMediaContentStatus)}
              disabled={moving}
              allowDeselect={false}
              style={{ flex: 1 }}
            />
          ) : (
            <Box />
          )}
          <Group gap={5} wrap="nowrap">
          {publishedLinks.length === 1 ? (
            <Tooltip label={`Open on ${platformLabel(publishedLinks[0][0])}`}>
              <ActionIcon
                component="a"
                href={publishedLinks[0][1]}
                target="_blank"
                rel="noreferrer"
                variant="light"
                aria-label={`Open ${item.title} on ${platformLabel(publishedLinks[0][0])}`}
              >
                <IconExternalLink size={17} />
              </ActionIcon>
            </Tooltip>
          ) : publishedLinks.length > 1 ? (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="light" aria-label={`Open published links for ${item.title}`}>
                  <IconExternalLink size={17} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {publishedLinks.map(([platform, url]) => (
                  <Menu.Item
                    key={platform}
                    component="a"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    leftSection={<IconExternalLink size={14} />}
                  >
                    {platformLabel(platform)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          ) : null}
          {driveLink ? (
            <Tooltip label="Open Drive project">
              <ActionIcon
                component="a"
                href={driveLink}
                target="_blank"
                rel="noreferrer"
                variant="light"
                color="gray"
                aria-label={`Open Drive project for ${item.title}`}
              >
                <IconLink size={17} />
              </ActionIcon>
            </Tooltip>
          ) : null}
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
};

const SocialMediaContentBoard = () => {
  const dispatch = useAppDispatch();
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const moduleAccess = useModuleAccess(MODULE_SLUG);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [searchParams, setSearchParams] = useSearchParams();
  const boardState = useMemo(() => parseSocialMediaBoardUrlState(searchParams), [searchParams]);
  const listQuery = useSocialMediaContentList(
    { includeArchived: true },
    { enabled: moduleAccess.ready && moduleAccess.canView },
  );
  const createMutation = useCreateSocialMediaContent();
  const updateMutation = useUpdateSocialMediaContent();
  const archiveMutation = useArchiveSocialMediaContent();
  const uploadThumbnailMutation = useUploadSocialMediaThumbnail();
  const removeThumbnailMutation = useRemoveSocialMediaThumbnail();

  const [editorValues, setEditorValues] = useState<SocialMediaEditorDraftValues>(EMPTY_EDITOR_VALUES);
  const [hydratedEditor, setHydratedEditor] = useState<string | null>(null);
  const [selectedThumbnail, setSelectedThumbnail] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [removeStoredThumbnail, setRemoveStoredThumbnail] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const initialEditorValues = useRef<string>(JSON.stringify(EMPTY_EDITOR_VALUES));
  const createdRecordAwaitingMedia = useRef<SocialMediaContentItem | null>(null);
  const partialSaveError = useRef<string | null>(null);
  const draftStorageKey = useMemo(
    () => buildSocialMediaEditorDraftStorageKey(loggedUserId),
    [loggedUserId],
  );

  useEffect(() => {
    dispatch(navigateToPage("Social Media"));
  }, [dispatch]);

  const updateUrlState = useCallback((changes: Partial<SocialMediaBoardUrlState>) => {
    const nextState = { ...boardState, ...changes };
    setSearchParams(writeSocialMediaBoardUrlState(searchParams, nextState), { replace: true });
  }, [boardState, searchParams, setSearchParams]);

  const allItems = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const selectedItem = useMemo(() => (
    typeof boardState.editor === "number"
      ? allItems.find((item) => item.id === boardState.editor)
        ?? (createdRecordAwaitingMedia.current?.id === boardState.editor
          ? createdRecordAwaitingMedia.current
          : null)
      : null
  ), [allItems, boardState.editor]);

  useEffect(() => {
    const currentKey = editorKey(boardState.editor);
    if (!currentKey) {
      createdRecordAwaitingMedia.current = null;
      partialSaveError.current = null;
      setHydratedEditor(null);
      setSelectedThumbnail(null);
      setRemoveStoredThumbnail(false);
      setEditorError(null);
      return;
    }
    if (hydratedEditor === currentKey) return;
    if (typeof boardState.editor === "number" && !selectedItem && listQuery.isLoading) return;

    const baseValues = boardState.editor === "new"
      ? EMPTY_EDITOR_VALUES
      : selectedItem
        ? itemToEditorValues(selectedItem)
        : EMPTY_EDITOR_VALUES;
    let nextValues = baseValues;
    try {
      const stored = parseStoredSocialMediaEditorDraft(
        window.localStorage.getItem(draftStorageKey),
      );
      if (stored && String(stored.editor) === currentKey) {
        nextValues = stored.values;
      }
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
    setEditorValues(nextValues);
    initialEditorValues.current = JSON.stringify(baseValues);
    if (createdRecordAwaitingMedia.current?.id !== boardState.editor) {
      setSelectedThumbnail(null);
      setRemoveStoredThumbnail(false);
    }
    setEditorError(partialSaveError.current ?? (
      typeof boardState.editor === "number" && !selectedItem
        ? "This content item no longer exists or is unavailable."
        : null
    ));
    setHydratedEditor(currentKey);
  }, [boardState.editor, draftStorageKey, hydratedEditor, listQuery.isLoading, selectedItem]);

  useEffect(() => {
    if (!selectedThumbnail) {
      setThumbnailPreview(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(selectedThumbnail);
    setThumbnailPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedThumbnail]);

  useEffect(() => {
    const currentKey = editorKey(boardState.editor);
    if (!currentKey || hydratedEditor !== currentKey) return;
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify({
        version: 1,
        editor: boardState.editor,
        values: editorValues,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // Draft persistence is a convenience and must never block editing.
    }
  }, [boardState.editor, draftStorageKey, editorValues, hydratedEditor]);

  const clearStoredDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore storage failures.
    }
  }, [draftStorageKey]);

  const isEditorDirty = useMemo(
    () => JSON.stringify(editorValues) !== initialEditorValues.current || Boolean(selectedThumbnail),
    [editorValues, selectedThumbnail],
  );

  const closeEditor = useCallback((force = false) => {
    if (!force && isEditorDirty && !window.confirm("Discard your unsaved social media changes?")) {
      return;
    }
    clearStoredDraft();
    createdRecordAwaitingMedia.current = null;
    partialSaveError.current = null;
    updateUrlState({ editor: null });
  }, [clearStoredDraft, isEditorDirty, updateUrlState]);

  const validateThumbnail = (file: File | null) => {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setEditorError("Use a JPG, PNG, WebP, or GIF thumbnail.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setEditorError("The thumbnail must be 5 MB or smaller.");
      return;
    }
    setEditorError(null);
    partialSaveError.current = null;
    setSelectedThumbnail(file);
    setRemoveStoredThumbnail(false);
  };

  const saveEditor = async () => {
    if (boardState.editor === null) return;
    if (!editorValues.title.trim()) {
      setEditorError("Add a title before saving this content.");
      return;
    }
    if (!editorValues.idea.trim()) {
      setEditorError("Add an idea or brief before saving this content.");
      return;
    }
    if (TASK_READY_STATUSES.has(editorValues.status)) {
      const missing = [
        !editorValues.onVideoCaptions.trim() ? "on-video captions" : null,
        !editorValues.platformCaption.trim() ? "platform caption" : null,
        normalizeHashtags(editorValues.hashtags).length === 0 ? "hashtags" : null,
        editorValues.targetPlatforms.length === 0 ? "target platforms" : null,
      ].filter(Boolean);
      if (missing.length > 0) {
        setEditorError(`Complete ${missing.join(", ")} before moving this content to ${editorValues.status.replace("_", " ")}.`);
        return;
      }
    }
    if (
      editorValues.status === "published"
      && !Object.entries(editorValues.platformLinks).some(
        ([platform, url]) => editorValues.targetPlatforms.includes(platform) && url.trim(),
      )
    ) {
      setEditorError("Add a published URL for at least one target platform before publishing.");
      return;
    }
    if (boardState.editor !== "new" && !selectedItem) {
      setEditorError("This content item cannot be updated because it is unavailable.");
      return;
    }
    setEditorError(null);
    partialSaveError.current = null;
    let savedRecord: SocialMediaContentItem | null = null;
    let thumbnailChangeStarted = false;
    try {
      const existingThumbnail = selectedItem?.thumbnailUrl ?? null;
      const payload = toPayload(
        editorValues,
        removeStoredThumbnail && existingThumbnail ? existingThumbnail : undefined,
      );
      const saved = boardState.editor === "new"
        ? await createMutation.mutateAsync(payload)
        : await updateMutation.mutateAsync({ id: boardState.editor as number, changes: payload });
      savedRecord = saved;
      if (boardState.editor === "new") {
        createdRecordAwaitingMedia.current = saved;
      }

      if (removeStoredThumbnail && existingThumbnail) {
        thumbnailChangeStarted = true;
        await removeThumbnailMutation.mutateAsync(saved.id);
      }
      if (selectedThumbnail) {
        thumbnailChangeStarted = true;
        await uploadThumbnailMutation.mutateAsync({ id: saved.id, file: selectedThumbnail });
      }
      clearStoredDraft();
      createdRecordAwaitingMedia.current = null;
      partialSaveError.current = null;
      closeEditor(true);
    } catch (error) {
      if (savedRecord && thumbnailChangeStarted) {
        updateUrlState({
          editor: resolveEditorAfterMediaFailure(boardState.editor, savedRecord.id),
        });
        const detail = getErrorMessage(error, "");
        const message = `The content record was saved, but its thumbnail change failed. Retry Save changes to finish the thumbnail without creating another record.${detail ? ` ${detail}` : ""}`;
        partialSaveError.current = message;
        setEditorError(message);
      } else {
        setEditorError(getErrorMessage(error, "Unable to save this content."));
      }
    }
  };

  const handleArchive = async (item: SocialMediaContentItem, fromEditor = false) => {
    if (!window.confirm(`Archive "${item.title}"?`)) return;
    try {
      await archiveMutation.mutateAsync(item.id);
      if (fromEditor) {
        clearStoredDraft();
        closeEditor(true);
      }
    } catch (error) {
      setEditorError(getErrorMessage(error, "Unable to archive this content."));
    }
  };

  const handleMove = async (item: SocialMediaContentItem, status: SocialMediaContentStatus) => {
    if (status === item.status) return;
    setMovingId(item.id);
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        changes: {
          status,
          ...(status === "published" && !item.publishedAt
            ? { publishedAt: new Date().toISOString() }
            : {}),
        },
      });
    } catch (error) {
      setEditorError(getErrorMessage(error, "Unable to move this content."));
    } finally {
      setMovingId(null);
    }
  };

  const filteredItems = useMemo(() => {
    const search = boardState.search.trim().toLowerCase();
    const platform = boardState.platform.trim().toLowerCase();
    return allItems.filter((item) => {
      if (boardState.status !== "all" && item.status !== boardState.status) return false;
      if (boardState.status === "all" && item.status === "archived") return false;
      if (platform && !item.targetPlatforms.some((value) => value.toLowerCase() === platform)) return false;
      if (!search) return true;
      const haystack = [
        item.title,
        item.idea,
        item.onVideoCaptions,
        item.platformCaption,
        ...item.hashtags,
        ...item.targetPlatforms,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    }).sort((left, right) => {
      const leftDate = left.scheduledAt ?? left.publishedAt ?? left.updatedAt;
      const rightDate = right.scheduledAt ?? right.publishedAt ?? right.updatedAt;
      return new Date(leftDate).getTime() - new Date(rightDate).getTime();
    });
  }, [allItems, boardState.platform, boardState.search, boardState.status]);

  const visibleStages = useMemo(() => {
    if (boardState.status !== "all") {
      return STAGES.filter((stage) => stage.value === boardState.status);
    }
    return STAGES.filter((stage) => stage.value !== "archived");
  }, [boardState.status]);

  const statusCounts = useMemo(() => SOCIAL_MEDIA_CONTENT_STATUSES.reduce((counts, status) => {
    counts[status] = allItems.filter((item) => item.status === status).length;
    return counts;
  }, {} as Record<SocialMediaContentStatus, number>), [allItems]);

  const isSaving = createMutation.isPending
    || updateMutation.isPending
    || uploadThumbnailMutation.isPending
    || removeThumbnailMutation.isPending;
  const activeCount = allItems.length - statusCounts.archived;
  const upcomingCount = statusCounts.planned + statusCounts.in_production + statusCounts.ready;
  const previewUrl = thumbnailPreview
    || (!removeStoredThumbnail ? editorValues.thumbnailUrl.trim() : "")
    || null;

  const pageContent = !moduleAccess.ready || moduleAccess.loading ? (
    <Center mih={320}><Loader variant="dots" /></Center>
  ) : !moduleAccess.canView ? (
    <Alert color="yellow" title="No access">
      You do not have permission to view social media content.
    </Alert>
  ) : (
    <Stack gap="lg" p={{ base: "sm", sm: "lg" }}>
      <Paper
        radius="xl"
        p={{ base: "md", sm: "lg" }}
        style={{
          background: "linear-gradient(125deg, #1b2559 0%, #5b3dc8 64%, #8b5cf6 100%)",
          color: "white",
          overflow: "hidden",
        }}
      >
        <Group justify="space-between" align="center" gap="md" wrap="wrap">
          <Group gap="md" wrap="nowrap">
            <ThemeIcon size={46} radius="lg" variant="white" color="violet">
              <IconLayoutKanban size={25} />
            </ThemeIcon>
            <Box>
              <Title order={isMobile ? 2 : 1} c="white">Social Media</Title>
              <Text c="rgba(255,255,255,.76)" size="sm">Plan every idea from brief to published post.</Text>
            </Box>
          </Group>
          {moduleAccess.canCreate ? (
            <Button
              color="white"
              c="violet.8"
              leftSection={<IconPlus size={18} />}
              onClick={() => updateUrlState({ editor: "new" })}
              fullWidth={Boolean(isMobile)}
              style={{ flexBasis: isMobile ? "100%" : "auto" }}
            >
              New content
            </Button>
          ) : null}
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {[
          { label: "Active", value: activeCount, color: "blue" },
          { label: "In the pipeline", value: upcomingCount, color: "violet" },
          { label: "Published", value: statusCounts.published, color: "teal" },
          { label: "Ideas", value: statusCounts.idea, color: "gray" },
        ].map((metric) => (
          <Paper key={metric.label} withBorder radius="lg" p="md" ta="center">
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">{metric.label}</Text>
            <Text fz={{ base: 24, sm: 30 }} fw={800} c={`${metric.color}.7`}>{metric.value}</Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Paper withBorder radius="lg" p="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <TextInput
            aria-label="Search social content"
            placeholder="Search ideas, captions, or hashtags"
            leftSection={<IconSearch size={17} />}
            value={boardState.search}
            onChange={(event) => updateUrlState({ search: event.currentTarget.value })}
            rightSection={boardState.search ? (
              <ActionIcon variant="subtle" color="gray" onClick={() => updateUrlState({ search: "" })} aria-label="Clear search">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          />
          <Select
            aria-label="Filter by status"
            value={boardState.status}
            onChange={(value) => updateUrlState({ status: (value || "all") as SocialMediaBoardUrlState["status"] })}
            data={[{ value: "all", label: "All active stages" }, ...STATUS_OPTIONS]}
            allowDeselect={false}
          />
          <Select
            aria-label="Filter by platform"
            placeholder="All platforms"
            value={boardState.platform || null}
            onChange={(value) => updateUrlState({ platform: value ?? "" })}
            data={PLATFORM_OPTIONS}
            clearable
          />
        </SimpleGrid>
      </Paper>

      {editorError && boardState.editor === null ? (
        <Alert color="red" withCloseButton onClose={() => setEditorError(null)}>{editorError}</Alert>
      ) : null}

      {listQuery.isLoading ? (
        <Center mih={280}><Loader variant="dots" /></Center>
      ) : listQuery.isError ? (
        <Alert
          color="red"
          title="Content could not be loaded"
          icon={<IconRefresh size={18} />}
        >
          <Group justify="space-between" gap="sm">
            <Text size="sm">{getErrorMessage(listQuery.error)}</Text>
            <Button size="xs" variant="light" onClick={() => void listQuery.refetch()}>Try again</Button>
          </Group>
        </Alert>
      ) : (
        <ScrollArea type="auto" offsetScrollbars>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "minmax(0, 1fr)"
                : `repeat(${visibleStages.length}, minmax(282px, 1fr))`,
              gap: 14,
              minWidth: isMobile ? undefined : visibleStages.length * 296,
              alignItems: "start",
              paddingBottom: 8,
            }}
          >
            {visibleStages.map((stage) => {
              const items = filteredItems.filter((item) => item.status === stage.value);
              const StageIcon = stage.icon;
              return (
                <Paper key={stage.value} radius="lg" p="sm" bg="gray.0" withBorder>
                  <Stack gap="sm">
                    <Group justify="space-between" px={4} py={2}>
                      <Group gap="xs">
                        <ThemeIcon size="sm" radius="xl" variant="light" color={stage.color}>
                          <StageIcon size={14} />
                        </ThemeIcon>
                        <Text fw={750} size="sm">{stage.label}</Text>
                      </Group>
                      <Badge variant="filled" color={stage.color} circle>{items.length}</Badge>
                    </Group>
                    {items.length ? items.map((item) => (
                      <SocialContentCard
                        key={item.id}
                        item={item}
                        canUpdate={moduleAccess.canUpdate}
                        canDelete={moduleAccess.canDelete}
                        moving={movingId === item.id}
                        onEdit={() => updateUrlState({ editor: item.id })}
                        onMove={(status) => void handleMove(item, status)}
                        onArchive={() => void handleArchive(item)}
                      />
                    )) : (
                      <Center mih={92}>
                        <Stack align="center" gap={4}>
                          <StageIcon size={21} color="var(--mantine-color-gray-5)" />
                          <Text size="xs" c="dimmed">No content here</Text>
                        </Stack>
                      </Center>
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        </ScrollArea>
      )}

      <Modal
        opened={boardState.editor !== null}
        onClose={() => closeEditor()}
        title={boardState.editor === "new" ? "Create social content" : "Edit social content"}
        size="min(1120px, 94vw)"
        fullScreen={Boolean(isMobile)}
        centered
        closeOnClickOutside={!isEditorDirty}
        scrollAreaComponent={ScrollArea.Autosize}
        styles={{ title: { fontWeight: 750, fontSize: isMobile ? 18 : 22 } }}
      >
        {!hydratedEditor || (typeof boardState.editor === "number" && listQuery.isLoading) ? (
          <Center mih={320}><Loader variant="dots" /></Center>
        ) : (
          <Stack gap="md">
            {editorError ? <Alert color="red">{editorError}</Alert> : null}
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <Stack gap="sm">
                <TextInput
                  label="Title"
                  placeholder="Give this content a clear working title"
                  required
                  value={editorValues.title}
                  onChange={(event) => setEditorValues((current) => ({ ...current, title: event.currentTarget.value }))}
                  autoFocus
                />
                <Textarea
                  label="Idea / brief"
                  placeholder="Describe the hook, shots, people, and outcome"
                  required
                  minRows={4}
                  autosize
                  maxRows={9}
                  value={editorValues.idea}
                  onChange={(event) => setEditorValues((current) => ({ ...current, idea: event.currentTarget.value }))}
                />
                <Textarea
                  label="On-video captions"
                  placeholder="Text that should appear inside the video"
                  minRows={3}
                  autosize
                  maxRows={8}
                  value={editorValues.onVideoCaptions}
                  onChange={(event) => setEditorValues((current) => ({ ...current, onVideoCaptions: event.currentTarget.value }))}
                />
                <Textarea
                  label="Platform caption"
                  placeholder="Final post caption or working copy"
                  minRows={4}
                  autosize
                  maxRows={10}
                  value={editorValues.platformCaption}
                  onChange={(event) => setEditorValues((current) => ({ ...current, platformCaption: event.currentTarget.value }))}
                />
                <TagsInput
                  label="Hashtags"
                  placeholder="Type a hashtag and press Enter"
                  value={editorValues.hashtags}
                  onChange={(hashtags) => setEditorValues((current) => ({ ...current, hashtags }))}
                  splitChars={[",", " "]}
                  clearable
                />
              </Stack>

              <Stack gap="sm">
                <MultiSelect
                  label="Target platforms"
                  placeholder="Select every destination"
                  data={PLATFORM_OPTIONS}
                  searchable
                  clearable
                  value={editorValues.targetPlatforms}
                  onChange={(targetPlatforms) => setEditorValues((current) => ({ ...current, targetPlatforms }))}
                />
                <Select
                  label="Stage"
                  data={STATUS_OPTIONS}
                  value={editorValues.status}
                  allowDeselect={false}
                  onChange={(value) => value && setEditorValues((current) => ({
                    ...current,
                    status: value as SocialMediaContentStatus,
                    publishedAt: value === "published" && !current.publishedAt
                      ? new Date().toISOString()
                      : current.publishedAt,
                  }))}
                />
                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                  <DateTimePicker
                    label="Scheduled for"
                    placeholder="Choose date and time"
                    value={toDate(editorValues.scheduledAt)}
                    onChange={(value) => setEditorValues((current) => ({
                      ...current,
                      scheduledAt: value ? value.toISOString() : null,
                    }))}
                    clearable
                    valueFormat="DD MMM YYYY, HH:mm"
                  />
                  <DateTimePicker
                    label="Published at"
                    placeholder="Choose date and time"
                    value={toDate(editorValues.publishedAt)}
                    onChange={(value) => setEditorValues((current) => ({
                      ...current,
                      publishedAt: value ? value.toISOString() : null,
                    }))}
                    clearable
                    valueFormat="DD MMM YYYY, HH:mm"
                  />
                </SimpleGrid>
                <TextInput
                  label="Drive project URL"
                  placeholder="https://drive.google.com/..."
                  leftSection={<IconLink size={16} />}
                  value={editorValues.driveProjectUrl}
                  onChange={(event) => setEditorValues((current) => ({ ...current, driveProjectUrl: event.currentTarget.value }))}
                />
                {editorValues.targetPlatforms.map((platform) => (
                  <TextInput
                    key={platform}
                    label={`${platformLabel(platform)} published URL`}
                    placeholder={`Paste the ${platformLabel(platform)} post URL`}
                    leftSection={<IconExternalLink size={16} />}
                    value={editorValues.platformLinks[platform] ?? ""}
                    onChange={(event) => {
                      const url = event.currentTarget.value;
                      setEditorValues((current) => ({
                        ...current,
                        platformLinks: { ...current.platformLinks, [platform]: url },
                      }));
                    }}
                  />
                ))}

                <Divider label="Thumbnail" labelPosition="center" />
                <Paper withBorder radius="lg" p="sm">
                  <Stack gap="sm">
                    {previewUrl ? (
                      <Image src={previewUrl} alt="Content thumbnail preview" h={210} radius="md" fit="cover" />
                    ) : (
                      <Center h={150} bg="gray.0" style={{ borderRadius: 10 }}>
                        <Stack align="center" gap={5}>
                          <IconPhoto size={30} color="var(--mantine-color-gray-5)" />
                          <Text size="sm" c="dimmed">No thumbnail selected</Text>
                        </Stack>
                      </Center>
                    )}
                    <TextInput
                      label="External thumbnail URL"
                      placeholder="https://..."
                      value={editorValues.thumbnailUrl}
                      disabled={Boolean(selectedThumbnail)}
                      onChange={(event) => {
                        setRemoveStoredThumbnail(false);
                        setEditorValues((current) => ({ ...current, thumbnailUrl: event.currentTarget.value }));
                      }}
                    />
                    <Group grow={Boolean(isMobile)} gap="xs">
                      <FileButton
                        onChange={validateThumbnail}
                        accept="image/jpeg,image/png,image/webp,image/gif"
                      >
                        {(props) => (
                          <Button {...props} variant="light" leftSection={<IconUpload size={17} />}>
                            Upload
                          </Button>
                        )}
                      </FileButton>
                      {previewUrl ? (
                        <Button
                          variant="light"
                          color="red"
                          leftSection={<IconTrash size={17} />}
                          onClick={() => {
                            setSelectedThumbnail(null);
                            setRemoveStoredThumbnail(Boolean(selectedItem?.thumbnailUrl));
                            setEditorValues((current) => ({ ...current, thumbnailUrl: "" }));
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </Group>
                    <Text size="xs" c="dimmed" ta="center">JPG, PNG, WebP, or GIF - max 5 MB</Text>
                  </Stack>
                </Paper>
              </Stack>
            </SimpleGrid>

            <Divider />
            <Group
              justify={moduleAccess.canDelete && selectedItem?.status !== "archived" ? "space-between" : "flex-end"}
              gap="sm"
              wrap="wrap"
            >
              {moduleAccess.canDelete && selectedItem && selectedItem.status !== "archived" ? (
                <Button
                  color="red"
                  variant="subtle"
                  leftSection={<IconArchive size={17} />}
                  disabled={isSaving}
                  fullWidth={Boolean(isMobile)}
                  onClick={() => void handleArchive(selectedItem, true)}
                >
                  Archive
                </Button>
              ) : null}
              <Group grow={Boolean(isMobile)} gap="sm" style={{ width: isMobile ? "100%" : "auto" }}>
                <Button variant="default" onClick={() => closeEditor()} disabled={isSaving}>Cancel</Button>
                {(boardState.editor === "new" ? moduleAccess.canCreate : moduleAccess.canUpdate) ? (
                  <Button
                    onClick={() => void saveEditor()}
                    loading={isSaving}
                    rightSection={<IconArrowRight size={17} />}
                  >
                    {boardState.editor === "new" ? "Create content" : "Save changes"}
                  </Button>
                ) : null}
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );

  return <PageAccessGuard pageSlug={PAGE_SLUGS.socialMedia}>{pageContent}</PageAccessGuard>;
};

export default SocialMediaContentBoard;
