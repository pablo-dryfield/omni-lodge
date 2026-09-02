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
  Paper,
  Progress,
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
import { DatePickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArchive,
  IconArrowRight,
  IconBrandInstagram,
  IconBrandTiktok,
  IconCalendar,
  IconCheck,
  IconClock,
  IconDotsVertical,
  IconExternalLink,
  IconFile,
  IconFolder,
  IconLayoutKanban,
  IconMovie,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import {
  SOCIAL_MEDIA_CONTENT_STATUSES,
  type SocialMediaAssetKind,
  type SocialMediaContentAsset,
  type SocialMediaContentItem,
  type SocialMediaProjectFolderCheckResult,
  type SocialMediaContentStatus,
  useArchiveSocialMediaContent,
  useCheckSocialMediaProjectFolder,
  useCreateSocialMediaContent,
  useCreateSocialMediaProjectFolder,
  useDeleteSocialMediaAsset,
  useMarkSocialMediaReady,
  usePlanSocialMediaContent,
  usePublishSocialMediaContent,
  useRemoveSocialMediaThumbnail,
  useSocialMediaContentList,
  useStartSocialMediaProduction,
  useUpdateSocialMediaContent,
  useUpdateSocialMediaPublicationLinks,
  useUploadSocialMediaThumbnail,
  useUploadSocialMediaAsset,
} from "../api/socialMedia";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  buildSocialMediaEditorDraftStorageKey,
  canAccessSocialMediaEditor,
  formatHashtag,
  normalizeHashtags,
  parseSocialMediaBoardUrlState,
  parseStoredSocialMediaEditorDraft,
  serializeSocialMediaEditorDraft,
  toSocialMediaDateOnly,
  type SocialMediaBoardUrlState,
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

const ACTIVE_STAGES = STAGES.filter((stage) => stage.value !== "archived");
const STATUS_OPTIONS = STAGES.map(({ value, label }) => ({ value, label }));

type IdeaDraft = {
  title: string;
  idea: string;
  onVideoCaptions: string;
  platformCaption: string;
  hashtags: string[];
};

const EMPTY_IDEA_DRAFT: IdeaDraft = {
  title: "",
  idea: "",
  onVideoCaptions: "",
  platformCaption: "",
  hashtags: [],
};

type WorkflowDialog =
  | { type: "plan"; contentId: number }
  | { type: "assets"; contentId: number }
  | { type: "thumbnail"; contentId: number }
  | { type: "publish"; contentId: number }
  | null;

type UploadProgressState = Record<string, number | null>;

const ideaDraftFromItem = (item: SocialMediaContentItem): IdeaDraft => ({
  title: item.title,
  idea: item.idea,
  onVideoCaptions: item.onVideoCaptions,
  platformCaption: item.platformCaption,
  hashtags: normalizeHashtags(item.hashtags).map(formatHashtag),
});

const getErrorMessage = (
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string => {
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

const formatPlannedDate = (value: string | null): string | null => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
};

const formatPublishedDate = (value: string | null): string | null => {
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

const dateOnlyToPickerValue = (value: string | null): Date | null => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isSafeHttpUrl = (value: string | null): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};

const nextActionLabel = (status: SocialMediaContentStatus): string | null => {
  if (status === "idea") return "Move to Planned";
  if (status === "planned") return "Start production";
  if (status === "in_production") return "Upload files & mark ready";
  if (status === "ready") return "Publish";
  return null;
};

const AssetRow = ({
  asset,
  disabled,
  onRemove,
}: {
  asset: SocialMediaContentAsset;
  disabled: boolean;
  onRemove: () => void;
}) => (
  <Paper withBorder radius="md" p="xs">
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group wrap="nowrap" gap="xs" style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color="gray" size="md"><IconFile size={15} /></ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text size="sm" fw={650} truncate>{asset.originalName}</Text>
          <Text size="xs" c="dimmed">{formatFileSize(asset.sizeBytes)}</Text>
        </Box>
      </Group>
      <Group gap={4} wrap="nowrap">
        {isSafeHttpUrl(asset.webViewUrl) ? (
          <Tooltip label="Open in Drive">
            <ActionIcon
              component="a"
              href={asset.webViewUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              variant="subtle"
              aria-label={`Open ${asset.originalName}`}
            >
              <IconExternalLink size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null}
        <Tooltip label="Remove file">
          <ActionIcon
            color="red"
            variant="subtle"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${asset.originalName}`}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  </Paper>
);

const SocialContentCard = ({
  item,
  canUpdate,
  canDelete,
  busy,
  onEdit,
  onNext,
  onEditPlannedDate,
  onManageAssets,
  onEditPublicationLinks,
  onThumbnail,
  onArchive,
}: {
  item: SocialMediaContentItem;
  canUpdate: boolean;
  canDelete: boolean;
  busy: boolean;
  onEdit: () => void;
  onNext: () => void;
  onEditPlannedDate: () => void;
  onManageAssets: () => void;
  onEditPublicationLinks: () => void;
  onThumbnail: () => void;
  onArchive: () => void;
}) => {
  const plannedLabel = formatPlannedDate(item.scheduledAt);
  const publishedLabel = formatPublishedDate(item.publishedAt);
  const displayedHashtags = normalizeHashtags(item.hashtags);
  const publishedLinks = Object.entries(item.platformLinks ?? {})
    .filter(([, url]) => isSafeHttpUrl(url));
  const actionLabel = nextActionLabel(item.status);
  const canEditPlannedDate = ["planned", "in_production", "ready", "published"]
    .includes(item.status);
  const canManageAssets = item.status === "in_production" || item.status === "ready";

  return (
    <Paper withBorder radius="lg" p="sm" shadow="xs" style={{ overflow: "hidden" }}>
      <Stack gap="sm">
        {item.thumbnailUrl ? (
          <Image src={item.thumbnailUrl} alt={`${item.title} thumbnail`} h={140} radius="md" fit="cover" />
        ) : null}
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={750} lineClamp={2}>{item.title}</Text>
            <Text size="sm" c="dimmed" lineClamp={3} mt={3}>{item.idea}</Text>
          </Box>
          {canUpdate || (canDelete && item.status !== "archived") ? (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${item.title}`}>
                  <IconDotsVertical size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {canUpdate && item.status !== "published" ? (
                  <Menu.Item onClick={onEdit}>Edit idea</Menu.Item>
                ) : null}
                {canUpdate && canEditPlannedDate ? (
                  <Menu.Item leftSection={<IconCalendar size={15} />} onClick={onEditPlannedDate}>
                    Change planned date
                  </Menu.Item>
                ) : null}
                {canUpdate && canManageAssets ? (
                  <Menu.Item
                    leftSection={<IconFolder size={15} />}
                    onClick={onManageAssets}
                    disabled={busy}
                  >
                    Manage production files
                  </Menu.Item>
                ) : null}
                {canUpdate && item.status === "published" ? (
                  <Menu.Item leftSection={<IconExternalLink size={15} />} onClick={onEditPublicationLinks}>
                    Edit published links
                  </Menu.Item>
                ) : null}
                {canUpdate ? (
                  <Menu.Item leftSection={<IconPhoto size={15} />} onClick={onThumbnail}>
                    {item.thumbnailUrl ? "Manage thumbnail" : "Add thumbnail"}
                  </Menu.Item>
                ) : null}
                {canDelete && item.status !== "archived" ? (
                  <Menu.Item color="red" leftSection={<IconArchive size={15} />} onClick={onArchive}>
                    Archive
                  </Menu.Item>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </Group>
        <Group gap={5}>
          <Badge size="sm" variant="light" color="pink" leftSection={<IconBrandInstagram size={12} />}>
            Instagram
          </Badge>
          <Badge size="sm" variant="light" color="dark" leftSection={<IconBrandTiktok size={12} />}>
            TikTok
          </Badge>
        </Group>
        {displayedHashtags.length > 0 ? (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {displayedHashtags.map((tag) => `#${tag}`).join(" ")}
          </Text>
        ) : null}
        <Stack gap={5}>
          <Group gap={6} wrap="nowrap">
            <IconUser size={15} color="var(--mantine-color-gray-6)" />
            <Text size="xs" c="dimmed" truncate>
              Created by {item.createdByName || "Unknown user"}
            </Text>
          </Group>
          {plannedLabel ? (
            <Group gap={6} wrap="nowrap">
              <IconCalendar size={15} color="var(--mantine-color-gray-6)" />
              <Text size="xs" c="dimmed" truncate>
                Planned for {plannedLabel}
              </Text>
            </Group>
          ) : null}
          {publishedLabel ? (
            <Group gap={6} wrap="nowrap">
              <IconExternalLink size={15} color="var(--mantine-color-gray-6)" />
              <Text size="xs" c="dimmed" truncate>
                Published {publishedLabel}
              </Text>
            </Group>
          ) : null}
          {(item.status === "in_production" || item.status === "ready") && item.assets.length > 0 ? (
            <Group gap={5}>
              <Badge size="xs" color="violet" variant="light">{item.assets.length} file{item.assets.length === 1 ? "" : "s"}</Badge>
              {item.driveProjectUrl ? <Badge size="xs" color="blue" variant="light">Drive ready</Badge> : null}
            </Group>
          ) : null}
        </Stack>
        {canUpdate && actionLabel ? (
          <Button
            fullWidth
            loading={busy}
            color={item.status === "ready" ? "teal" : item.status === "in_production" ? "violet" : "blue"}
            rightSection={<IconArrowRight size={16} />}
            onClick={onNext}
          >
            {actionLabel}
          </Button>
        ) : null}
        {(publishedLinks.length > 0 || isSafeHttpUrl(item.driveProjectUrl)) ? (
          <Group grow gap="xs">
            {publishedLinks.slice(0, 2).map(([platform, url]) => (
              <Button
                key={platform}
                component="a"
                href={url}
                target="_blank"
                rel="noreferrer"
                size="xs"
                variant="light"
                leftSection={platform === "instagram" ? <IconBrandInstagram size={14} /> : <IconBrandTiktok size={14} />}
              >
                {platform === "instagram" ? "Instagram" : "TikTok"}
              </Button>
            ))}
            {isSafeHttpUrl(item.driveProjectUrl) ? (
              <Button
                component="a"
                href={item.driveProjectUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                size="xs"
                variant="light"
                color="gray"
                leftSection={<IconFolder size={14} />}
              >
                Drive
              </Button>
            ) : null}
          </Group>
        ) : null}
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
  const planMutation = usePlanSocialMediaContent();
  const startProductionMutation = useStartSocialMediaProduction();
  const folderMutation = useCreateSocialMediaProjectFolder();
  const folderCheckMutation = useCheckSocialMediaProjectFolder();
  const uploadAssetMutation = useUploadSocialMediaAsset();
  const deleteAssetMutation = useDeleteSocialMediaAsset();
  const readyMutation = useMarkSocialMediaReady();
  const publishMutation = usePublishSocialMediaContent();
  const updatePublicationLinksMutation = useUpdateSocialMediaPublicationLinks();
  const uploadThumbnailMutation = useUploadSocialMediaThumbnail();
  const removeThumbnailMutation = useRemoveSocialMediaThumbnail();

  const [ideaDraft, setIdeaDraft] = useState<IdeaDraft>(EMPTY_IDEA_DRAFT);
  const [hydratedEditor, setHydratedEditor] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [workflowDialog, setWorkflowDialog] = useState<WorkflowDialog>(null);
  const [plannedDate, setPlannedDate] = useState<Date | null>(null);
  const [publishLinks, setPublishLinks] = useState({ instagram: "", tiktok: "" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({});
  const [mobileStage, setMobileStage] = useState<SocialMediaContentStatus>("idea");
  const initialIdeaDraft = useRef(JSON.stringify(EMPTY_IDEA_DRAFT));
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

  const showMobileStage = useCallback((status: SocialMediaContentStatus) => {
    if (!isMobile) return;
    setMobileStage(status);
    updateUrlState({ status });
  }, [isMobile, updateUrlState]);

  const allItems = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const selectedItem = useMemo(() => (
    typeof boardState.editor === "number"
      ? allItems.find((item) => item.id === boardState.editor) ?? null
      : null
  ), [allItems, boardState.editor]);
  const workflowItem = useMemo(() => (
    workflowDialog
      ? allItems.find((item) => item.id === workflowDialog.contentId) ?? null
      : null
  ), [allItems, workflowDialog]);

  const editorAuthorized = canAccessSocialMediaEditor(boardState.editor, moduleAccess);

  useEffect(() => {
    const editorKey = boardState.editor === null ? null : String(boardState.editor);
    if (!editorKey) {
      setHydratedEditor(null);
      setEditorError(null);
      return;
    }
    if (moduleAccess.ready && !editorAuthorized) {
      setHydratedEditor(editorKey);
      setEditorError(null);
      return;
    }
    if (hydratedEditor === editorKey) return;
    if (typeof boardState.editor === "number" && !selectedItem && listQuery.isLoading) return;
    const base = boardState.editor === "new"
      ? EMPTY_IDEA_DRAFT
      : selectedItem
        ? ideaDraftFromItem(selectedItem)
        : EMPTY_IDEA_DRAFT;
    let next = base;
    try {
      const stored = parseStoredSocialMediaEditorDraft(
        window.localStorage.getItem(draftStorageKey),
      );
      if (stored && String(stored.editor) === editorKey) {
        next = {
          title: stored.values.title,
          idea: stored.values.idea,
          onVideoCaptions: stored.values.onVideoCaptions,
          platformCaption: stored.values.platformCaption,
          hashtags: normalizeHashtags(stored.values.hashtags).map(formatHashtag),
        };
      }
    } catch {
      // Draft persistence must never prevent opening the editor.
    }
    setIdeaDraft(next);
    initialIdeaDraft.current = JSON.stringify(base);
    setEditorError(
      typeof boardState.editor === "number" && !selectedItem
        ? "This content item is no longer available."
        : null,
    );
    setHydratedEditor(editorKey);
  }, [
    boardState.editor,
    draftStorageKey,
    editorAuthorized,
    hydratedEditor,
    listQuery.isLoading,
    moduleAccess.ready,
    selectedItem,
  ]);

  useEffect(() => {
    const editorKey = boardState.editor === null ? null : String(boardState.editor);
    if (!editorKey || hydratedEditor !== editorKey || !editorAuthorized) return;
    try {
      window.localStorage.setItem(
        draftStorageKey,
        serializeSocialMediaEditorDraft(boardState.editor!, ideaDraft),
      );
    } catch {
      // Local drafts are a convenience only.
    }
  }, [boardState.editor, draftStorageKey, editorAuthorized, hydratedEditor, ideaDraft]);

  useEffect(() => {
    if (!workflowItem || !workflowDialog) return;
    setWorkflowError(null);
    if (workflowDialog.type === "plan") {
      setPlannedDate(dateOnlyToPickerValue(workflowItem.scheduledAt));
    }
    if (workflowDialog.type === "publish") {
      setPublishLinks({
        instagram: workflowItem.platformLinks.instagram ?? "",
        tiktok: workflowItem.platformLinks.tiktok ?? "",
      });
    }
    if (workflowDialog.type === "assets") setUploadProgress({});
    // Item data refreshes while a dialog is open; reset inputs only when the dialog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowDialog?.contentId, workflowDialog?.type]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore browser storage errors.
    }
  }, [draftStorageKey]);

  const editorDirty = useMemo(
    () => JSON.stringify(ideaDraft) !== initialIdeaDraft.current,
    [ideaDraft],
  );

  const closeEditor = useCallback((force = false) => {
    if (!force && editorDirty && !window.confirm("Discard your unsaved idea changes?")) return;
    clearDraft();
    updateUrlState({ editor: null });
  }, [clearDraft, editorDirty, updateUrlState]);

  const saveIdea = async () => {
    if (boardState.editor === null) return;
    if (!editorAuthorized) {
      setEditorError(
        boardState.editor === "new"
          ? "You do not have permission to create Social Media ideas."
          : "You do not have permission to edit Social Media ideas.",
      );
      return;
    }
    if (!ideaDraft.title.trim()) {
      setEditorError("Add a title before saving the idea.");
      return;
    }
    if (!ideaDraft.idea.trim()) {
      setEditorError("Add the idea or brief before saving.");
      return;
    }
    const payload = {
      title: ideaDraft.title.trim(),
      idea: ideaDraft.idea.trim(),
      onVideoCaptions: ideaDraft.onVideoCaptions.trim(),
      platformCaption: ideaDraft.platformCaption.trim(),
      hashtags: normalizeHashtags(ideaDraft.hashtags),
    };
    try {
      setEditorError(null);
      if (boardState.editor === "new") await createMutation.mutateAsync(payload);
      else await updateMutation.mutateAsync({ id: boardState.editor, changes: payload });
      clearDraft();
      closeEditor(true);
    } catch (error) {
      setEditorError(getErrorMessage(error, "Unable to save this idea."));
    }
  };

  const handleArchive = async (item: SocialMediaContentItem) => {
    if (!window.confirm(`Archive "${item.title}"?`)) return;
    try {
      setBusyId(item.id);
      await archiveMutation.mutateAsync(item.id);
    } catch (error) {
      setPageMessage(null);
      setWorkflowError(getErrorMessage(error, "Unable to archive this content."));
    } finally {
      setBusyId(null);
    }
  };

  const handleMissingProjectFolder = useCallback((
    result: SocialMediaProjectFolderCheckResult,
  ): boolean => {
    if (!result.reset) return false;
    setWorkflowDialog(null);
    setWorkflowError(null);
    setPageMessage(
      "The Drive project folder was deleted. This content was moved back to Planned so you can start production and create the folder again.",
    );
    showMobileStage("planned");
    return true;
  }, [showMobileStage]);

  const openProductionFiles = async (item: SocialMediaContentItem) => {
    try {
      setBusyId(item.id);
      setWorkflowError(null);
      const result = await folderCheckMutation.mutateAsync(item.id);
      if (handleMissingProjectFolder(result)) return;
      setWorkflowDialog({ type: "assets", contentId: result.item.id });
    } catch (error) {
      setWorkflowDialog(null);
      setWorkflowError(getErrorMessage(
        error,
        "Unable to verify the Drive project folder. Please try again.",
      ));
    } finally {
      setBusyId(null);
    }
  };

  const openPublishDialog = async (item: SocialMediaContentItem) => {
    try {
      setBusyId(item.id);
      setWorkflowError(null);
      const result = await folderCheckMutation.mutateAsync(item.id);
      if (handleMissingProjectFolder(result)) return;
      setWorkflowDialog({ type: "publish", contentId: result.item.id });
    } catch (error) {
      setWorkflowDialog(null);
      setWorkflowError(getErrorMessage(
        error,
        "Unable to verify the Drive project folder. Please try again.",
      ));
    } finally {
      setBusyId(null);
    }
  };

  const handleNext = async (item: SocialMediaContentItem) => {
    setWorkflowError(null);
    if (item.status === "idea") {
      setWorkflowDialog({ type: "plan", contentId: item.id });
      return;
    }
    if (item.status === "in_production") {
      await openProductionFiles(item);
      return;
    }
    if (item.status === "ready") {
      await openPublishDialog(item);
      return;
    }
    if (item.status !== "planned") return;
    try {
      setBusyId(item.id);
      await startProductionMutation.mutateAsync(item.id);
      showMobileStage("in_production");
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to start production."));
    } finally {
      setBusyId(null);
    }
  };

  const submitPlan = async () => {
    if (!workflowItem) return;
    const scheduledDate = toSocialMediaDateOnly(plannedDate);
    if (!scheduledDate) {
      setWorkflowError("Choose the date when this content is planned.");
      return;
    }
    try {
      setBusyId(workflowItem.id);
      setWorkflowError(null);
      const previousStatus = workflowItem.status;
      const updatedItem = await planMutation.mutateAsync({ id: workflowItem.id, scheduledDate });
      setWorkflowDialog(null);
      if (previousStatus !== "idea") setPageMessage("Planned date updated.");
      showMobileStage(updatedItem.status);
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to plan this idea."));
    } finally {
      setBusyId(null);
    }
  };

  const createProjectFolder = async () => {
    if (!workflowItem) return;
    try {
      setBusyId(workflowItem.id);
      setWorkflowError(null);
      await folderMutation.mutateAsync(workflowItem.id);
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to create the Drive folder."));
    } finally {
      setBusyId(null);
    }
  };

  const uploadFiles = async (kind: SocialMediaAssetKind, files: File[]) => {
    if (!workflowItem || files.length === 0) return;
    setWorkflowError(null);
    for (const file of files) {
      const key = `${kind}:${file.name}:${file.lastModified}`;
      try {
        setUploadProgress((current) => ({ ...current, [key]: 0 }));
        await uploadAssetMutation.mutateAsync({
          id: workflowItem.id,
          assetType: kind,
          file,
          onProgress: ({ percent }) => setUploadProgress((current) => ({ ...current, [key]: percent })),
        });
        setUploadProgress((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      } catch (error) {
        setWorkflowError(getErrorMessage(error, `Unable to upload ${file.name}.`));
        setUploadProgress((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        break;
      }
    }
  };

  const removeAsset = async (asset: SocialMediaContentAsset) => {
    if (!workflowItem || !window.confirm(`Remove "${asset.originalName}" from this project?`)) return;
    try {
      setWorkflowError(null);
      const updatedItem = await deleteAssetMutation.mutateAsync({
        id: workflowItem.id,
        assetId: asset.id,
      });
      if (workflowItem.status === "ready" && updatedItem.status === "in_production") {
        setPageMessage("A required file was removed, so this item returned to Production.");
        showMobileStage("in_production");
      }
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to remove this file."));
    }
  };

  const uploadThumbnail = async (file: File) => {
    if (!workflowItem) return;
    try {
      setWorkflowError(null);
      await uploadThumbnailMutation.mutateAsync({ id: workflowItem.id, file });
      setPageMessage("Thumbnail updated.");
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to upload this thumbnail."));
    }
  };

  const removeThumbnail = async () => {
    if (!workflowItem || !workflowItem.thumbnailUrl) return;
    if (!window.confirm(`Remove the thumbnail from "${workflowItem.title}"?`)) return;
    try {
      setWorkflowError(null);
      await removeThumbnailMutation.mutateAsync(workflowItem.id);
      setPageMessage("Thumbnail removed.");
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to remove this thumbnail."));
    }
  };

  const markReady = async () => {
    if (!workflowItem) return;
    try {
      setBusyId(workflowItem.id);
      setWorkflowError(null);
      const folderCheck = await folderCheckMutation.mutateAsync(workflowItem.id);
      if (handleMissingProjectFolder(folderCheck)) return;
      await readyMutation.mutateAsync(workflowItem.id);
      setWorkflowDialog(null);
      showMobileStage("ready");
    } catch (error) {
      setWorkflowError(getErrorMessage(error, "Unable to mark this content ready."));
    } finally {
      setBusyId(null);
    }
  };

  const publish = async () => {
    if (!workflowItem) return;
    if (!publishLinks.instagram.trim() || !publishLinks.tiktok.trim()) {
      setWorkflowError("Add both the Instagram and TikTok links.");
      return;
    }
    try {
      setBusyId(workflowItem.id);
      setWorkflowError(null);
      if (workflowItem.status === "published") {
        await updatePublicationLinksMutation.mutateAsync({
          id: workflowItem.id,
          platformLinks: {
            instagram: publishLinks.instagram.trim(),
            tiktok: publishLinks.tiktok.trim(),
          },
        });
        setWorkflowDialog(null);
        setPageMessage("Published links updated.");
        return;
      }
      const folderCheck = await folderCheckMutation.mutateAsync(workflowItem.id);
      if (handleMissingProjectFolder(folderCheck)) return;
      const result = await publishMutation.mutateAsync({
        id: workflowItem.id,
        platformLinks: {
          instagram: publishLinks.instagram.trim(),
          tiktok: publishLinks.tiktok.trim(),
        },
      });
      setWorkflowDialog(null);
      setPageMessage(
        result.taskCompletion
          ? `Published and completed Task Planner task #${result.taskCompletion.taskLogId}.`
          : "Published successfully.",
      );
      showMobileStage("published");
    } catch (error) {
      setWorkflowError(getErrorMessage(
        error,
        workflowItem.status === "published"
          ? "Unable to update the published links."
          : "Unable to publish this content.",
      ));
    } finally {
      setBusyId(null);
    }
  };

  const filteredItems = useMemo(() => {
    const search = boardState.search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (boardState.status !== "all" && item.status !== boardState.status) return false;
      if (boardState.status === "all" && item.status === "archived") return false;
      if (!search) return true;
      return [
        item.title,
        item.idea,
        item.onVideoCaptions,
        item.platformCaption,
        item.createdByName ?? "",
        ...item.hashtags,
      ].join(" ").toLowerCase().includes(search);
    });
  }, [allItems, boardState.search, boardState.status]);

  const visibleStages = useMemo(() => {
    if (boardState.status !== "all") return STAGES.filter((stage) => stage.value === boardState.status);
    if (isMobile) return ACTIVE_STAGES.filter((stage) => stage.value === mobileStage);
    return ACTIVE_STAGES;
  }, [boardState.status, isMobile, mobileStage]);

  const statusCounts = useMemo(() => SOCIAL_MEDIA_CONTENT_STATUSES.reduce((counts, status) => {
    counts[status] = allItems.filter((item) => item.status === status).length;
    return counts;
  }, {} as Record<SocialMediaContentStatus, number>), [allItems]);

  const assetGroups = useMemo(() => {
    const assets = workflowItem?.assets ?? [];
    return {
      final_video: assets.filter((asset) => asset.kind === "final_video"),
      raw_material: assets.filter((asset) => asset.kind === "raw_material"),
      project_file: assets.filter((asset) => asset.kind === "project_file"),
    };
  }, [workflowItem?.assets]);
  const hasEveryRequiredAsset = assetGroups.final_video.length > 0
    && assetGroups.raw_material.length > 0
    && assetGroups.project_file.length > 0;
  const uploadInProgress = Object.keys(uploadProgress).length > 0 || uploadAssetMutation.isPending;
  const thumbnailPending = uploadThumbnailMutation.isPending || removeThumbnailMutation.isPending;
  const readyTransitionPending = readyMutation.isPending || folderCheckMutation.isPending;
  const publicationLinksPending = publishMutation.isPending
    || updatePublicationLinksMutation.isPending
    || folderCheckMutation.isPending;
  const savingIdea = createMutation.isPending || updateMutation.isPending;

  const pageContent = !moduleAccess.ready || moduleAccess.loading ? (
    <Center mih={320}><Loader variant="dots" /></Center>
  ) : !moduleAccess.canView ? (
    <Alert color="yellow" title="No access">You do not have permission to view Social Media content.</Alert>
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
              <Text c="rgba(255,255,255,.76)" size="sm">Ideas, production files, and publishing in one flow.</Text>
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
              New idea
            </Button>
          ) : null}
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {[
          { label: "Ideas", value: statusCounts.idea, color: "gray" },
          { label: "Planned", value: statusCounts.planned, color: "blue" },
          { label: "In production", value: statusCounts.in_production, color: "violet" },
          { label: "Ready", value: statusCounts.ready, color: "orange" },
        ].map((metric) => (
          <Paper key={metric.label} withBorder radius="lg" p="md" ta="center">
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">{metric.label}</Text>
            <Text fz={{ base: 24, sm: 30 }} fw={800} c={`${metric.color}.7`}>{metric.value}</Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Paper withBorder radius="lg" p="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput
            aria-label="Search social content"
            placeholder="Search ideas, captions, hashtags, or creator"
            leftSection={<IconSearch size={17} />}
            value={boardState.search}
            onChange={(event) => updateUrlState({ search: event.currentTarget.value })}
            rightSection={boardState.search ? (
              <ActionIcon variant="subtle" color="gray" onClick={() => updateUrlState({ search: "" })} aria-label="Clear search">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          />
          {isMobile ? (
            <Select
              aria-label="Board stage"
              value={boardState.status === "all" ? mobileStage : boardState.status}
              onChange={(value) => {
                if (!value) return;
                const stage = value as SocialMediaContentStatus;
                setMobileStage(stage);
                updateUrlState({ status: stage });
              }}
              data={STATUS_OPTIONS}
              allowDeselect={false}
            />
          ) : (
            <Select
              aria-label="Filter by stage"
              value={boardState.status}
              onChange={(value) => updateUrlState({ status: (value || "all") as SocialMediaBoardUrlState["status"] })}
              data={[{ value: "all", label: "All active stages" }, ...STATUS_OPTIONS]}
              allowDeselect={false}
            />
          )}
        </SimpleGrid>
      </Paper>

      {pageMessage ? (
        <Alert color="green" icon={<IconCheck size={18} />} withCloseButton onClose={() => setPageMessage(null)}>
          {pageMessage}
        </Alert>
      ) : null}
      {workflowError && workflowDialog === null ? (
        <Alert color="red" withCloseButton onClose={() => setWorkflowError(null)}>{workflowError}</Alert>
      ) : null}

      {listQuery.isLoading ? (
        <Center mih={280}><Loader variant="dots" /></Center>
      ) : listQuery.isError ? (
        <Alert color="red" title="Content could not be loaded" icon={<IconRefresh size={18} />}>
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
                        busy={busyId === item.id}
                        onEdit={() => updateUrlState({ editor: item.id })}
                        onNext={() => void handleNext(item)}
                        onEditPlannedDate={() => setWorkflowDialog({ type: "plan", contentId: item.id })}
                        onManageAssets={() => void openProductionFiles(item)}
                        onEditPublicationLinks={() => setWorkflowDialog({ type: "publish", contentId: item.id })}
                        onThumbnail={() => setWorkflowDialog({ type: "thumbnail", contentId: item.id })}
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
        onClose={() => editorAuthorized ? closeEditor() : updateUrlState({ editor: null })}
        title={boardState.editor === "new" ? "Create idea" : "Edit idea"}
        size="min(720px, 94vw)"
        fullScreen={Boolean(isMobile)}
        centered
        closeOnClickOutside={!editorDirty}
        scrollAreaComponent={ScrollArea.Autosize}
        styles={{ title: { fontWeight: 750, fontSize: isMobile ? 18 : 22 } }}
      >
        {!editorAuthorized ? (
          <Stack gap="md">
            <Alert color="yellow" title="Editor access required">
              {boardState.editor === "new"
                ? "You can view this board, but you do not have permission to create Social Media ideas."
                : "You can view this board, but you do not have permission to edit Social Media ideas."}
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => updateUrlState({ editor: null })}>Close</Button>
            </Group>
          </Stack>
        ) : !hydratedEditor || (typeof boardState.editor === "number" && listQuery.isLoading) ? (
          <Center mih={300}><Loader variant="dots" /></Center>
        ) : (
          <Stack gap="md">
            {editorError ? <Alert color="red">{editorError}</Alert> : null}
            <TextInput
              label="Title"
              placeholder="Working title"
              required
              value={ideaDraft.title}
              onChange={(event) => setIdeaDraft((current) => ({ ...current, title: event.currentTarget.value }))}
              autoFocus
            />
            <Textarea
              label="Idea"
              placeholder="Hook, shots, people, and outcome"
              required
              minRows={4}
              autosize
              maxRows={9}
              value={ideaDraft.idea}
              onChange={(event) => setIdeaDraft((current) => ({ ...current, idea: event.currentTarget.value }))}
            />
            <Textarea
              label="On-video captions"
              placeholder="Text shown inside the video"
              minRows={3}
              autosize
              maxRows={7}
              value={ideaDraft.onVideoCaptions}
              onChange={(event) => setIdeaDraft((current) => ({ ...current, onVideoCaptions: event.currentTarget.value }))}
            />
            <Textarea
              label="Platform caption"
              placeholder="Caption for Instagram and TikTok"
              minRows={4}
              autosize
              maxRows={9}
              value={ideaDraft.platformCaption}
              onChange={(event) => setIdeaDraft((current) => ({ ...current, platformCaption: event.currentTarget.value }))}
            />
            <TagsInput
              label="Hashtags"
              placeholder="Type a hashtag and press Enter"
              value={ideaDraft.hashtags}
              onChange={(values) => setIdeaDraft((current) => ({
                ...current,
                hashtags: normalizeHashtags(values).map(formatHashtag),
              }))}
              splitChars={[",", " "]}
              clearable
            />
            <Divider />
            <Group justify="flex-end" grow={Boolean(isMobile)}>
              <Button variant="default" onClick={() => closeEditor()} disabled={savingIdea}>Cancel</Button>
              <Button onClick={() => void saveIdea()} loading={savingIdea}>
                {boardState.editor === "new" ? "Create idea" : "Save changes"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={workflowDialog?.type === "thumbnail"}
        onClose={() => !thumbnailPending && setWorkflowDialog(null)}
        title="Thumbnail"
        size="min(720px, 94vw)"
        fullScreen={Boolean(isMobile)}
        centered
        closeOnClickOutside={!thumbnailPending}
      >
        {!workflowItem ? (
          <Center mih={260}><Loader variant="dots" /></Center>
        ) : (
          <Stack gap="lg">
            {workflowError ? <Alert color="red">{workflowError}</Alert> : null}
            <Paper
              withBorder
              radius="lg"
              p="sm"
              bg="gray.0"
              mih={220}
              style={{ display: "grid", placeItems: "center", overflow: "hidden" }}
            >
              {workflowItem.thumbnailUrl ? (
                <Image
                  src={workflowItem.thumbnailUrl}
                  alt={`${workflowItem.title} thumbnail`}
                  fit="contain"
                  mah={isMobile ? "55vh" : 420}
                  radius="md"
                />
              ) : (
                <Stack align="center" gap="xs" c="dimmed">
                  <ThemeIcon size={54} radius="xl" color="gray" variant="light">
                    <IconPhoto size={28} />
                  </ThemeIcon>
                  <Text size="sm">No thumbnail yet</Text>
                </Stack>
              )}
            </Paper>
            <Group justify="center" grow={Boolean(isMobile)}>
              <FileButton
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(file) => file && void uploadThumbnail(file)}
              >
                {(props) => (
                  <Button
                    {...props}
                    loading={uploadThumbnailMutation.isPending}
                    disabled={removeThumbnailMutation.isPending}
                    leftSection={<IconUpload size={17} />}
                  >
                    {workflowItem.thumbnailUrl ? "Replace thumbnail" : "Upload thumbnail"}
                  </Button>
                )}
              </FileButton>
              {workflowItem.thumbnailUrl ? (
                <Button
                  color="red"
                  variant="light"
                  loading={removeThumbnailMutation.isPending}
                  disabled={uploadThumbnailMutation.isPending}
                  leftSection={<IconTrash size={17} />}
                  onClick={() => void removeThumbnail()}
                >
                  Remove
                </Button>
              ) : null}
            </Group>
            <Button variant="default" onClick={() => setWorkflowDialog(null)} disabled={thumbnailPending}>
              Done
            </Button>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={workflowDialog?.type === "plan"}
        onClose={() => !planMutation.isPending && setWorkflowDialog(null)}
        title={workflowItem?.status === "idea" ? "Move to Planned" : "Change planned date"}
        size="min(560px, 94vw)"
        fullScreen={Boolean(isMobile)}
        centered
      >
        <Stack gap="lg">
          {workflowError ? <Alert color="red">{workflowError}</Alert> : null}
          <DatePickerInput
            label="Planned date"
            placeholder="Choose a date"
            value={plannedDate}
            onChange={setPlannedDate}
            valueFormat="DD MMM YYYY"
            required
            clearable
            size="md"
          />
          <Group justify="flex-end" grow={Boolean(isMobile)}>
            <Button variant="default" onClick={() => setWorkflowDialog(null)} disabled={planMutation.isPending}>Cancel</Button>
            <Button onClick={() => void submitPlan()} loading={planMutation.isPending}>
              {workflowItem?.status === "idea" ? "Move to Planned" : "Save date"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={workflowDialog?.type === "assets"}
        onClose={() => !uploadInProgress && !readyTransitionPending && setWorkflowDialog(null)}
        title="Production files"
        size="min(920px, 96vw)"
        fullScreen={Boolean(isMobile)}
        centered
        closeOnClickOutside={!uploadInProgress && !readyTransitionPending}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="lg">
          {workflowError ? <Alert color="red">{workflowError}</Alert> : null}
          {!workflowItem ? (
            <Center mih={180}><Loader variant="dots" /></Center>
          ) : (
            <>
              <Paper withBorder radius="lg" p="md">
                <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon color={workflowItem.driveProjectUrl ? "green" : "blue"} variant="light" size="lg">
                      <IconFolder size={20} />
                    </ThemeIcon>
                    <Box>
                      <Text fw={700}>Drive project folder</Text>
                      <Text size="xs" c="dimmed">
                        {workflowItem.driveProjectUrl ? "Folder ready" : "Create it before uploading files"}
                      </Text>
                    </Box>
                  </Group>
                  {workflowItem.driveProjectUrl ? (
                    <Button
                      component="a"
                      href={workflowItem.driveProjectUrl}
                      target="_blank"
                      rel="noreferrer"
                      variant="light"
                      leftSection={<IconExternalLink size={16} />}
                    >
                      Open folder
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void createProjectFolder()}
                      loading={folderMutation.isPending}
                      leftSection={<IconPlus size={16} />}
                    >
                      Create folder
                    </Button>
                  )}
                </Group>
              </Paper>

              {workflowItem.driveProjectUrl ? (
                <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                  <Paper withBorder radius="lg" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between">
                        <Text fw={750}>Final video</Text>
                        <Badge color={assetGroups.final_video.length ? "green" : "red"} variant="light">
                          {assetGroups.final_video.length ? "Ready" : "Required"}
                        </Badge>
                      </Group>
                      {assetGroups.final_video.map((asset) => (
                        <AssetRow key={asset.id} asset={asset} disabled={deleteAssetMutation.isPending} onRemove={() => void removeAsset(asset)} />
                      ))}
                      {assetGroups.final_video.length === 0 ? (
                        <FileButton accept="video/*,.mkv,.avi" onChange={(file) => file && void uploadFiles("final_video", [file])}>
                          {(props) => (
                            <Button {...props} variant="light" leftSection={<IconMovie size={16} />} disabled={uploadInProgress}>
                              Upload video
                            </Button>
                          )}
                        </FileButton>
                      ) : null}
                    </Stack>
                  </Paper>

                  <Paper withBorder radius="lg" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between">
                        <Text fw={750}>Raw material</Text>
                        <Badge color={assetGroups.raw_material.length ? "green" : "red"} variant="light">
                          {assetGroups.raw_material.length || "Required"}
                        </Badge>
                      </Group>
                      {assetGroups.raw_material.map((asset) => (
                        <AssetRow key={asset.id} asset={asset} disabled={deleteAssetMutation.isPending} onRemove={() => void removeAsset(asset)} />
                      ))}
                      <FileButton multiple onChange={(files) => files && void uploadFiles("raw_material", files)}>
                        {(props) => (
                          <Button {...props} variant="light" leftSection={<IconUpload size={16} />} disabled={uploadInProgress}>
                            Add files
                          </Button>
                        )}
                      </FileButton>
                    </Stack>
                  </Paper>

                  <Paper withBorder radius="lg" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between">
                        <Text fw={750}>Project files</Text>
                        <Badge color={assetGroups.project_file.length ? "green" : "red"} variant="light">
                          {assetGroups.project_file.length || "Required"}
                        </Badge>
                      </Group>
                      {assetGroups.project_file.map((asset) => (
                        <AssetRow key={asset.id} asset={asset} disabled={deleteAssetMutation.isPending} onRemove={() => void removeAsset(asset)} />
                      ))}
                      <FileButton multiple onChange={(files) => files && void uploadFiles("project_file", files)}>
                        {(props) => (
                          <Button {...props} variant="light" leftSection={<IconUpload size={16} />} disabled={uploadInProgress}>
                            Add files
                          </Button>
                        )}
                      </FileButton>
                    </Stack>
                  </Paper>
                </SimpleGrid>
              ) : null}

              {Object.entries(uploadProgress).map(([key, percent]) => (
                <Box key={key}>
                  <Group justify="space-between" mb={4} wrap="nowrap">
                    <Text size="xs" truncate>{key.split(":")[1]}</Text>
                    <Text size="xs" c="dimmed">{percent == null ? "Uploading..." : `${percent}%`}</Text>
                  </Group>
                  <Progress value={percent ?? 100} animated={percent == null} />
                </Box>
              ))}

              <Divider />
              <Group justify="flex-end" grow={Boolean(isMobile)}>
                <Button
                  variant="default"
                  onClick={() => setWorkflowDialog(null)}
                  disabled={uploadInProgress || readyTransitionPending}
                >
                  Close
                </Button>
                {workflowItem.status === "in_production" ? (
                  <Button
                    color="violet"
                    leftSection={<IconCheck size={17} />}
                    disabled={!workflowItem.driveProjectUrl
                      || !hasEveryRequiredAsset
                      || uploadInProgress
                      || readyTransitionPending}
                    loading={readyTransitionPending}
                    onClick={() => void markReady()}
                  >
                    Mark ready
                  </Button>
                ) : null}
              </Group>
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={workflowDialog?.type === "publish"}
        onClose={() => !publicationLinksPending && setWorkflowDialog(null)}
        title={workflowItem?.status === "published" ? "Edit published links" : "Publish content"}
        size="min(620px, 94vw)"
        fullScreen={Boolean(isMobile)}
        centered
      >
        <Stack gap="lg">
          {workflowError ? <Alert color="red">{workflowError}</Alert> : null}
          <TextInput
            label="Instagram link"
            placeholder="https://www.instagram.com/reel/..."
            leftSection={<IconBrandInstagram size={17} />}
            value={publishLinks.instagram}
            onChange={(event) => setPublishLinks((current) => ({ ...current, instagram: event.currentTarget.value }))}
            required
          />
          <TextInput
            label="TikTok link"
            placeholder="https://www.tiktok.com/@.../video/..."
            leftSection={<IconBrandTiktok size={17} />}
            value={publishLinks.tiktok}
            onChange={(event) => setPublishLinks((current) => ({ ...current, tiktok: event.currentTarget.value }))}
            required
          />
          {workflowItem?.status === "published" ? (
            <Text size="sm" c="dimmed" ta="center">
              Saving updates the links in the linked Task Planner evidence without changing the original publication time.
            </Text>
          ) : (
            <Text size="sm" c="dimmed" ta="center">
              The publish time is recorded automatically. Your matching Task Planner task will be completed with these links and the project notes.
            </Text>
          )}
          <Group justify="flex-end" grow={Boolean(isMobile)}>
            <Button variant="default" onClick={() => setWorkflowDialog(null)} disabled={publicationLinksPending}>Cancel</Button>
            <Button color="teal" onClick={() => void publish()} loading={publicationLinksPending}>
              {workflowItem?.status === "published" ? "Save links" : "Publish"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );

  return <PageAccessGuard pageSlug={PAGE_SLUGS.socialMedia}>{pageContent}</PageAccessGuard>;
};

export default SocialMediaContentBoard;
