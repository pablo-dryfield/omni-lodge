import {
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Image,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBrandInstagram,
  IconBrandTiktok,
  IconCalendar,
  IconExternalLink,
  IconFile,
  IconFolder,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type {
  SocialMediaContentAsset,
  SocialMediaContentItem,
  SocialMediaContentStatus,
} from "../../api/socialMedia";
import {
  normalizeHashtags,
  SOCIAL_MEDIA_PUBLICATION_TIMEZONE,
} from "../../utils/socialMediaBoardState";
import SocialMediaAttribution from "./SocialMediaAttribution";

type SocialMediaIdeaViewModalProps = {
  item: SocialMediaContentItem | null;
  opened: boolean;
  onClose: () => void;
  fullScreen?: boolean;
};

const STATUS_PRESENTATION: Record<SocialMediaContentStatus, { label: string; color: string }> = {
  idea: { label: "Idea", color: "gray" },
  planned: { label: "Planned", color: "blue" },
  in_production: { label: "In production", color: "violet" },
  ready: { label: "Ready", color: "orange" },
  published: { label: "Published", color: "teal" },
  archived: { label: "Archived", color: "dark" },
};

const ASSET_KIND_LABELS: Record<SocialMediaContentAsset["kind"], string> = {
  final_video: "Final video",
  raw_material: "Raw material",
  project_file: "Project file",
};

const formatDateOnly = (value: string | null): string | null => {
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

const formatDateTime = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SOCIAL_MEDIA_PUBLICATION_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
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

const isSafeHttpUrl = (value: string | null): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const labelize = (value: string): string => value
  .trim()
  .replace(/[_-]+/gu, " ")
  .replace(/\b\w/gu, (character) => character.toUpperCase());

const PlatformIcon = ({ platform, size = 15 }: { platform: string; size?: number }) => {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "instagram") return <IconBrandInstagram size={size} />;
  if (normalized === "tiktok") return <IconBrandTiktok size={size} />;
  return <IconExternalLink size={size} />;
};

const DetailBlock = ({ label, value }: { label: string; value: string }) => (
  <Box ta="center">
    <Text size="xs" fw={750} tt="uppercase" c="dimmed" mb={5} ta="center">{label}</Text>
    <Text
      size="sm"
      c={value ? undefined : "dimmed"}
      ta="center"
      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
    >
      {value || "Not added"}
    </Text>
  </Box>
);

const TimelineValue = ({ label, value }: { label: string; value: string | null }) => (
  <Paper withBorder radius="md" p="sm" bg="gray.0" ta="center">
    <Text size="10px" fw={750} tt="uppercase" c="dimmed" ta="center">{label}</Text>
    <Text size="sm" fw={650} mt={3} ta="center">{value || "Not yet"}</Text>
  </Paper>
);

const LinkButton = ({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <Button
    component="a"
    href={href}
    target="_blank"
    rel="noreferrer"
    variant="light"
    size="sm"
    leftSection={icon}
    rightSection={<IconExternalLink size={14} />}
  >
    {children}
  </Button>
);

export const SocialMediaIdeaViewModal = ({
  item,
  opened,
  onClose,
  fullScreen = false,
}: SocialMediaIdeaViewModalProps) => {
  const status = item ? STATUS_PRESENTATION[item.status] : null;
  const hashtags = item ? normalizeHashtags(item.hashtags) : [];
  const platforms = item?.targetPlatforms ?? [];
  const publishedLinks = Object.entries(item?.platformLinks ?? {})
    .filter(([, url]) => isSafeHttpUrl(url));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Idea details"
      size="min(900px, 96vw)"
      fullScreen={fullScreen}
      centered
      scrollAreaComponent={ScrollArea.Autosize}
      styles={{
        header: { position: "relative" },
        title: {
          fontWeight: 750,
          fontSize: fullScreen ? 18 : 21,
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          textAlign: "center",
          whiteSpace: "nowrap",
        },
      }}
    >
      {!item || !status ? (
        <Center mih={220}>
          <Text c="dimmed">This idea is no longer available.</Text>
        </Center>
      ) : (
        <Stack gap="lg">
          <Paper
            radius="lg"
            p={{ base: "md", sm: "lg" }}
            style={{
              background: "linear-gradient(125deg, var(--mantine-color-indigo-9), var(--mantine-color-violet-7))",
              color: "white",
            }}
          >
            <Stack gap="sm" align="center">
              <Badge color={status.color} variant="white" size="lg">{status.label}</Badge>
              <Title order={2} c="white" ta="center" style={{ overflowWrap: "anywhere" }}>
                {item.title}
              </Title>
              <Text size="xs" c="rgba(255,255,255,.78)" ta="center">
                Last updated {formatDateTime(item.updatedAt) || "date unavailable"}
                {item.updatedByName ? ` by ${item.updatedByName}` : ""}
              </Text>
            </Stack>
          </Paper>

          {item.thumbnailUrl ? (
            <Paper withBorder radius="lg" p="xs" bg="gray.0">
              <Image
                src={item.thumbnailUrl}
                alt={`${item.title} thumbnail`}
                fit="contain"
                mah={fullScreen ? 300 : 420}
                radius="md"
              />
            </Paper>
          ) : null}

          <Box>
            <Text fw={750} mb="xs" ta="center">People</Text>
            <SocialMediaAttribution item={item} />
          </Box>

          <Box>
            <Group gap={7} mb="xs" justify="center">
              <IconCalendar size={17} color="var(--mantine-color-blue-6)" />
              <Text fw={750}>Timeline</Text>
            </Group>
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
              <TimelineValue label="Created" value={formatDateTime(item.createdAt)} />
              <TimelineValue label="Planned" value={formatDateOnly(item.scheduledAt)} />
              <TimelineValue label="Production started" value={formatDateTime(item.productionStartedAt)} />
              <TimelineValue label="Ready" value={formatDateTime(item.readyAt)} />
              <TimelineValue label="Published" value={formatDateTime(item.publishedAt)} />
              <TimelineValue label="Last updated" value={formatDateTime(item.updatedAt)} />
            </SimpleGrid>
          </Box>

          <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
            <Stack gap="md">
              <DetailBlock label="Idea" value={item.idea.trim()} />
              <Divider />
              <DetailBlock label="On-video captions" value={item.onVideoCaptions.trim()} />
              <Divider />
              <DetailBlock label="Platform caption" value={item.platformCaption.trim()} />
            </Stack>
          </Paper>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Paper withBorder radius="lg" p="md">
              <Text fw={750} mb="sm" ta="center">Platforms</Text>
              {platforms.length ? (
                <Group gap="xs" justify="center">
                  {platforms.map((platform) => (
                    <Badge
                      key={platform}
                      size="lg"
                      variant="light"
                      color={platform.toLowerCase() === "instagram" ? "pink" : "dark"}
                      leftSection={<PlatformIcon platform={platform} size={13} />}
                    >
                      {labelize(platform)}
                    </Badge>
                  ))}
                </Group>
              ) : <Text size="sm" c="dimmed" ta="center">No platforms selected</Text>}
            </Paper>
            <Paper withBorder radius="lg" p="md">
              <Text fw={750} mb="sm" ta="center">Hashtags</Text>
              {hashtags.length ? (
                <Group gap={6} justify="center">
                  {hashtags.map((hashtag) => (
                    <Badge key={hashtag} variant="light" color="blue">#{hashtag}</Badge>
                  ))}
                </Group>
              ) : <Text size="sm" c="dimmed" ta="center">No hashtags added</Text>}
            </Paper>
          </SimpleGrid>

          {(isSafeHttpUrl(item.driveProjectUrl) || item.assets.length > 0) ? (
            <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
              <Stack align="center" gap="sm" mb={item.assets.length ? "md" : 0}>
                <Group gap="xs" justify="center">
                  <ThemeIcon color="violet" variant="light"><IconFolder size={17} /></ThemeIcon>
                  <Box ta="center">
                    <Text fw={750} ta="center">Project files</Text>
                    <Text size="xs" c="dimmed" ta="center">
                      {item.assets.length} file{item.assets.length === 1 ? "" : "s"}
                    </Text>
                  </Box>
                </Group>
                {isSafeHttpUrl(item.driveProjectUrl) ? (
                  <LinkButton href={item.driveProjectUrl!} icon={<IconFolder size={16} />}>Drive folder</LinkButton>
                ) : null}
              </Stack>
              {item.assets.length ? (
                <Stack gap="xs">
                  {item.assets.map((asset) => (
                    <Paper key={asset.id} withBorder radius="md" p="sm" bg="gray.0">
                      <Stack align="center" gap="xs">
                        <Group wrap="nowrap" gap="xs" justify="center" style={{ minWidth: 0, maxWidth: "100%" }}>
                          <ThemeIcon variant="light" color="gray"><IconFile size={16} /></ThemeIcon>
                          <Box style={{ minWidth: 0 }} ta="center">
                            <Text size="sm" fw={650} ta="center" style={{ overflowWrap: "anywhere" }}>{asset.originalName}</Text>
                            <Group gap={6} mt={2} justify="center">
                              <Badge size="xs" variant="light">{ASSET_KIND_LABELS[asset.kind]}</Badge>
                              <Text size="xs" c="dimmed">{formatFileSize(asset.sizeBytes)}</Text>
                              {asset.uploadedBy ? <Text size="xs" c="dimmed">User #{asset.uploadedBy}</Text> : null}
                            </Group>
                          </Box>
                        </Group>
                        {isSafeHttpUrl(asset.webViewUrl) ? (
                          <Button
                            component="a"
                            href={asset.webViewUrl!}
                            target="_blank"
                            rel="noreferrer"
                            variant="subtle"
                            size="compact-sm"
                            aria-label={`Open ${asset.originalName}`}
                          >
                            <IconExternalLink size={17} />
                          </Button>
                        ) : null}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : null}
            </Paper>
          ) : null}

          {publishedLinks.length ? (
            <Paper withBorder radius="lg" p="md">
              <Text fw={750} mb="sm" ta="center">Published links</Text>
              <Group gap="xs" grow={fullScreen} justify="center">
                {publishedLinks.map(([platform, url]) => (
                  <LinkButton key={platform} href={url} icon={<PlatformIcon platform={platform} />}>
                    {labelize(platform)}
                  </LinkButton>
                ))}
              </Group>
            </Paper>
          ) : null}

          <Group justify="center">
            <Button variant="default" onClick={onClose} fullWidth={fullScreen}>Close</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

export default SocialMediaIdeaViewModal;
