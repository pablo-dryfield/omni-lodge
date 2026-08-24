import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  ActionIcon,
  Collapse,
  Flex,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconStar,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import { effectiveReviewMonth } from "../../utils/reviewCreditMonth";
import ReviewMonthlySummary from "../reviewCounters/ReviewMonthlySummary";
import DailyReviewTrend, { type TrendSnapshot } from "./DailyReviewTrend";
type Staff = {
  userId: number;
  name: string;
  assigned: number;
  manual: number;
  reviewCount: number;
  deletedReviewCount: number;
  total: number;
  platforms: PlatformSummary[];
};
type ReviewDetail = { id: number; reviewerName: string; comment: string | null; rating: number; reviewCreatedAt: string; creditMonth: string | null; isDeleted: boolean; credit: number };
type ManualDetail = { id: number; date: string; credit: number; notes: string | null };
type ManualDeleteTarget = {
  staffName: string;
  platform: string;
  entry: ManualDetail;
};
type ManualEditTarget = ManualDeleteTarget;
type ManualEditForm = {
  userId: string;
  platform: string;
  credit: number;
  description: string;
};
type PlatformSummary = { platform: string; assigned: number; manual: number; reviewCount: number; deletedReviewCount: number; total: number; reviews: ReviewDetail[]; deletedReviews: ReviewDetail[]; manualEntries: ManualDetail[] };
type User = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
};
type MonthLock = {
  month: string;
  isLocked: boolean;
  reviewCount: number | null;
  lockedAt: string | null;
  lockedByName: string | null;
};
type UnassignedReview = {
  id: number;
  platform: string;
  reviewerName: string;
  comment: string | null;
  rating: number;
  reviewCreatedAt: string;
  creditMonth: string | null;
  isDeleted: boolean;
};
type OverviewSummary = {
  staff: Staff[];
  reviewCount: number;
  deletedCount: number;
  unassignedCount: number;
  unassignedReviews?: UnassignedReview[];
  users?: User[];
  trendSnapshots?: TrendSnapshot[];
  manualCategoryTotals?: { noName: number; bad: number };
  lock: MonthLock | null;
};
type ReviewOverviewDashboardProps = {
  canManage?: boolean;
  canUpdateManualCredits?: boolean;
  canDeleteManualCredits?: boolean;
  currentUserId?: number;
  month: string;
  onMonthChange: (month: string) => void;
};

const overviewRequests = new Map<string, Promise<{ data: OverviewSummary }>>();
const LEGACY_REVIEW_COUNTER_NOTE_PREFIX = "Backfilled from legacy review counter #";

const fetchReviewOverview = (month: string): Promise<{ data: OverviewSummary }> => {
  const pending = overviewRequests.get(month);
  if (pending) {
    return pending;
  }
  const start = dayjs(`${month}-01`);
  const request = axiosInstance.get<OverviewSummary>("/reviews/archive/summary", {
    params: {
      start: start.format("YYYY-MM-DD"),
      end: start.endOf("month").format("YYYY-MM-DD"),
    },
  }).finally(() => overviewRequests.delete(month));
  overviewRequests.set(month, request);
  return request;
};

export default function ReviewOverviewDashboard({
  canManage = false,
  canUpdateManualCredits,
  canDeleteManualCredits,
  currentUserId = 0,
  month,
  onMonthChange,
}: ReviewOverviewDashboardProps) {
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<OverviewSummary>({ staff: [], reviewCount: 0, deletedCount: 0, unassignedCount: 0, unassignedReviews: [], users: [], trendSnapshots: [], manualCategoryTotals: { noName: 0, bad: 0 }, lock: null });
  const [users, setUsers] = useState<User[]>([]);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState("");
  const [manualModalOpened, setManualModalOpened] = useState(false);
  const [unassignedModalOpened, setUnassignedModalOpened] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualEditTarget, setManualEditTarget] = useState<ManualEditTarget | null>(null);
  const [manualEditForm, setManualEditForm] = useState<ManualEditForm>({
    userId: "",
    platform: "manual",
    credit: 1,
    description: "",
  });
  const [manualEditBusy, setManualEditBusy] = useState(false);
  const [manualEditError, setManualEditError] = useState("");
  const [manualDeleteTarget, setManualDeleteTarget] = useState<ManualDeleteTarget | null>(null);
  const [manualDeleteBusy, setManualDeleteBusy] = useState(false);
  const [manualDeleteError, setManualDeleteError] = useState("");
  const [form, setForm] = useState({
    userId: "",
    category: "staff" as "staff" | "no_name" | "bad",
    platform: "manual",
    credit: 1,
    notes: "",
  });
  const load = useCallback(async () => {
    const s = await fetchReviewOverview(month);
    setSummary(s.data);
    setUsers(s.data.users ?? []);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async () => {
    setManualBusy(true);
    setManualError("");
    try {
      await axiosInstance.post("/reviews/archive/manual-credits", {
        ...form,
        userId: form.category === "staff" ? Number(form.userId) : null,
        date: `${month}-01`,
      });
      setForm((current) => ({ ...current, credit: 1, notes: "" }));
      await load();
      setManualModalOpened(false);
    } catch (error: any) {
      setManualError(error.response?.data?.[0]?.message ?? error.message ?? "Unable to add the manual counter entry.");
    } finally {
      setManualBusy(false);
    }
  };
  const removeManualCredit = async () => {
    if (!manualDeleteTarget) {
      return;
    }
    setManualDeleteBusy(true);
    setManualDeleteError("");
    try {
      await axiosInstance.delete(`/reviews/archive/manual-credits/${manualDeleteTarget.entry.id}`);
      await load();
      setManualDeleteTarget(null);
    } catch (error: any) {
      setManualDeleteError(
        error.response?.data?.[0]?.message ?? error.message ?? "Unable to remove the manual addition.",
      );
    } finally {
      setManualDeleteBusy(false);
    }
  };
  const updateManualCredit = async () => {
    if (!manualEditTarget) {
      return;
    }
    setManualEditBusy(true);
    setManualEditError("");
    try {
      await axiosInstance.patch(`/reviews/archive/manual-credits/${manualEditTarget.entry.id}`, {
        userId: Number(manualEditForm.userId),
        platform: manualEditForm.platform,
        credit: manualEditForm.credit,
        notes: manualEditForm.description.trim() || null,
      });
      await load();
      setManualEditTarget(null);
    } catch (error: any) {
      setManualEditError(
        error.response?.data?.[0]?.message ?? error.message ?? "Unable to update the manual addition.",
      );
    } finally {
      setManualEditBusy(false);
    }
  };
  const toggleMonthLock = async () => {
    setLockBusy(true);
    setLockError("");
    try {
      if (summary.lock?.isLocked) {
        await axiosInstance.delete("/reviews/archive/month-lock", { data: { month } });
      } else {
        await axiosInstance.put("/reviews/archive/month-lock", { month });
      }
      await load();
    } catch (error: any) {
      setLockError(error.response?.data?.[0]?.message ?? error.message ?? "Unable to update the final review count.");
    } finally {
      setLockBusy(false);
    }
  };
  const cards = [
    ["Reviews counted", summary.reviewCount, IconStar, "blue"],
    ["Assigned staff", summary.staff.length, IconUsers, "teal"],
    ["Needs assignment", summary.unassignedCount, IconAlertTriangle, "orange"],
    ["Deleted in archive", summary.deletedCount, IconTrash, "red"],
  ] as const;
  const currentUserTotal = summary.staff.find((staff) => staff.userId === currentUserId)?.total ?? 0;
  const unassignedReviews = summary.unassignedReviews ?? [];
  const canUpdateManualEntries = canManage && Boolean(canUpdateManualCredits);
  const canDeleteManualEntries = canManage && Boolean(canDeleteManualCredits);
  const moveMonth = (amount: number) =>
    onMonthChange(dayjs(`${month}-01`).add(amount, "month").format("YYYY-MM"));
  const toggleUser = (userId: number) => setExpandedUsers(current => { const next = new Set(current); next.has(userId) ? next.delete(userId) : next.add(userId); return next; });
  const togglePlatform = (key: string) => setExpandedPlatforms(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const platformLabel = (platform: string) => ({ google: "Google", tripadvisor: "TripAdvisor", airbnb: "Airbnb", getyourguide: "GetYourGuide", manual: "Manual" }[platform] ?? platform);

  const renderStaffDetails = (staff: Staff) => (
    <Stack p={{ base: "xs", sm: "md" }} gap="xs" bg="var(--mantine-color-gray-0)">
      {staff.platforms.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="sm">
          No platform details are available for this person.
        </Text>
      )}
      {staff.platforms.map((platform) => {
        const platformKey = `${staff.userId}:${platform.platform}`;
        const platformOpen = expandedPlatforms.has(platformKey);
        return (
          <Paper key={platform.platform} withBorder radius="md" style={{ overflow: "hidden" }}>
            <UnstyledButton
              w="100%"
              p="sm"
              onClick={() => togglePlatform(platformKey)}
              aria-expanded={platformOpen}
            >
              <Flex
                direction={{ base: "column", sm: "row" }}
                align="center"
                justify="space-between"
                gap="sm"
              >
                <Group gap="xs" justify="center" wrap="wrap">
                  {platformOpen ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                  <Text fw={700} ta="center">{platformLabel(platform.platform)}</Text>
                  <Badge variant="light">{platform.reviewCount} reviews</Badge>
                  {platform.deletedReviewCount > 0 && (
                    <Badge color="red" variant="light">
                      {platform.deletedReviewCount} deleted ref{platform.deletedReviewCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </Group>
                <Group gap="md" justify="center" wrap="wrap">
                  <Text size="sm">Assigned {platform.assigned.toFixed(3)}</Text>
                  {platform.manual > 0 && (
                    <Badge color="orange" variant="light">
                      Manual {platform.manual.toFixed(3)}
                    </Badge>
                  )}
                  <Badge>{platform.total.toFixed(3)}</Badge>
                </Group>
              </Flex>
            </UnstyledButton>
            <Collapse in={platformOpen}>
              <Stack p="sm" pt={0} gap="xs">
                {platform.reviews.map((review) => (
                  <Paper key={review.id} p="sm" bg="white" withBorder>
                    <Flex
                      direction={{ base: "column", sm: "row" }}
                      justify="space-between"
                      align="center"
                      gap="xs"
                    >
                      <Stack gap={0} align="center">
                        <Text fw={600} ta="center">{review.reviewerName}</Text>
                        <Text size="xs" c="dimmed" ta="center">
                          Counted in {dayjs(`${effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth)}-01`).format("MMMM YYYY")} · Credit {review.credit.toFixed(3)}
                        </Text>
                      </Stack>
                      <Group gap="xs" justify="center" wrap="wrap">
                        <Badge color="yellow">★ {review.rating.toFixed(1)}</Badge>
                        {review.isDeleted && <Badge color="red">Deleted later · Still counted</Badge>}
                      </Group>
                    </Flex>
                    <Text size="sm" mt="xs" ta="center" style={{ overflowWrap: "anywhere" }}>
                      {review.comment || "No written comment"}
                    </Text>
                  </Paper>
                ))}
                {(platform.deletedReviews ?? []).length > 0 && (
                  <>
                    <Text size="xs" fw={700} c="red" mt="xs" ta="center">
                      Deleted references — excluded from counts, targets, and payments
                    </Text>
                    {(platform.deletedReviews ?? []).map((review) => (
                      <Paper key={`deleted-${review.id}`} p="sm" bg="var(--mantine-color-red-0)" withBorder>
                        <Flex
                          direction={{ base: "column", sm: "row" }}
                          justify="space-between"
                          align="center"
                          gap="xs"
                        >
                          <Stack gap={0} align="center">
                            <Text fw={600} ta="center">{review.reviewerName}</Text>
                            <Text size="xs" c="dimmed" ta="center">
                              Originally assigned to {dayjs(`${effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth)}-01`).format("MMMM YYYY")}
                            </Text>
                          </Stack>
                          <Group gap="xs" justify="center" wrap="wrap">
                            <Badge color="yellow">★ {review.rating.toFixed(1)}</Badge>
                            <Badge color="red">Deleted · Not counted</Badge>
                          </Group>
                        </Flex>
                        <Text size="sm" mt="xs" ta="center" style={{ overflowWrap: "anywhere" }}>
                          {review.comment || "No written comment"}
                        </Text>
                      </Paper>
                    ))}
                  </>
                )}
                {platform.manualEntries.map((entry) => {
                  const isLegacyEntry = String(entry.notes ?? "").startsWith(
                    LEGACY_REVIEW_COUNTER_NOTE_PREFIX,
                  );
                  const canEditEntry = canUpdateManualEntries && !isLegacyEntry;

                  return (
                    <Paper
                      key={`manual-${entry.id}`}
                      p="sm"
                      bg="white"
                      withBorder
                    >
                      <Flex
                        direction={{ base: "column", sm: "row" }}
                        align="center"
                        justify="space-between"
                        gap="sm"
                      >
                        <Stack gap="xs" align="center" style={{ flex: 1 }}>
                          <Text fw={600}>Manual addition</Text>
                          <Text size="xs" c="dimmed">{dayjs(entry.date).format("MMMM YYYY")}</Text>
                          <Badge color="orange" variant="light">{entry.credit.toFixed(3)}</Badge>
                          <Paper
                            withBorder
                            radius="sm"
                            p="xs"
                            w="100%"
                            bg="var(--mantine-color-gray-0)"
                          >
                            <Text size="xs" fw={700} c="dimmed" ta="center">Description</Text>
                            <Text size="sm" ta="center" style={{ overflowWrap: "anywhere" }}>
                              {entry.notes || "No description provided"}
                            </Text>
                          </Paper>
                        </Stack>
                        {(canDeleteManualEntries || canEditEntry) && (
                          <Group gap="xs" wrap="nowrap" justify="center">
                            {canEditEntry && (
                              <Button
                                size="xs"
                                color="blue"
                                variant="light"
                                leftSection={<IconPencil size={15} />}
                                aria-label={`Edit ${entry.credit.toFixed(3)} manual addition for ${staff.name}`}
                                onClick={() => {
                                  setManualEditError("");
                                  setManualEditTarget({
                                    staffName: staff.name,
                                    platform: platform.platform,
                                    entry,
                                  });
                                  setManualEditForm({
                                    userId: String(staff.userId),
                                    platform: platform.platform,
                                    credit: entry.credit,
                                    description: entry.notes ?? "",
                                  });
                                }}
                              >
                                Edit
                              </Button>
                            )}
                            {canDeleteManualEntries && (
                              <Button
                                size="xs"
                                color="red"
                                variant="light"
                                leftSection={<IconTrash size={15} />}
                                aria-label={`Remove ${entry.credit.toFixed(3)} manual addition for ${staff.name}`}
                                onClick={() => {
                                  setManualDeleteError("");
                                  setManualDeleteTarget({
                                    staffName: staff.name,
                                    platform: platform.platform,
                                    entry,
                                  });
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </Group>
                        )}
                      </Flex>
                    </Paper>
                  );
                })}
              </Stack>
            </Collapse>
          </Paper>
        );
      })}
    </Stack>
  );

  return (
    <Stack gap="lg">
      <Stack gap="md" align="center">
        <Stack gap={2} align="center">
          <Title order={2} ta="center">Review performance</Title>
        </Stack>
        <Flex
          direction={{ base: "column", sm: "row" }}
          justify="center"
          align="center"
          gap="sm"
          w="100%"
        >
          <Group gap="xs" wrap="nowrap" w="100%" maw={280} justify="center">
            <ActionIcon variant="default" size="lg" aria-label="Previous month" onClick={() => moveMonth(-1)}>
              <IconChevronLeft size={18} />
            </ActionIcon>
            <TextInput
              aria-label="Review month"
              type="month"
              value={month}
              onChange={(event) => onMonthChange(event.currentTarget.value)}
              style={{ flex: 1 }}
              styles={{ input: { textAlign: "center" } }}
            />
            <ActionIcon variant="default" size="lg" aria-label="Next month" onClick={() => moveMonth(1)}>
              <IconChevronRight size={18} />
            </ActionIcon>
          </Group>
          {canManage && (
            <Button
              w={{ base: "100%", sm: "auto" }}
              maw={280}
              color={summary.lock?.isLocked ? "orange" : "blue"}
              variant={summary.lock?.isLocked ? "light" : "filled"}
              leftSection={summary.lock?.isLocked ? <IconLockOpen size={17} /> : <IconLock size={17} />}
              loading={lockBusy}
              onClick={() => void toggleMonthLock()}
            >
              {summary.lock?.isLocked ? "Unlock final count" : "Lock final count"}
            </Button>
          )}
        </Flex>
        {lockError && <Text c="red" size="sm" ta="center">{lockError}</Text>}
      </Stack>
      {canManage ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {cards.map(([label, value, Icon, color]) => {
          const content = (
            <Stack align="center" gap={4}>
              <Icon size={22} />
              <Text c="dimmed" size="sm" ta="center">{label}</Text>
              <Text fz={32} fw={800} c={color} ta="center">
                {value}
              </Text>
              {label === "Needs assignment" && (
                <Text size="xs" c="blue" fw={600} ta="center">View reviews</Text>
              )}
            </Stack>
          );

          return label === "Needs assignment" ? (
            <Paper key={label} p={0} withBorder radius="lg" style={{ overflow: "hidden" }}>
              <UnstyledButton
                w="100%"
                h="100%"
                p={{ base: "md", sm: "lg" }}
                aria-label={`View ${value} reviews needing assignment`}
                onClick={() => setUnassignedModalOpened(true)}
              >
                {content}
              </UnstyledButton>
            </Paper>
          ) : (
            <Paper key={label} p={{ base: "md", sm: "lg" }} withBorder radius="lg">
              {content}
            </Paper>
          );
          })}
        </SimpleGrid>
      ) : (
        <Paper
          p={{ base: "md", sm: "lg" }}
          withBorder
          radius="lg"
          maw={420}
          w="100%"
          mx="auto"
          role="group"
          aria-label="Your reviews total"
        >
          <Stack align="center" gap={4}>
            <IconStar size={22} />
            <Text c="dimmed" size="sm" ta="center">Reviews</Text>
            <Text fz={32} fw={800} c="blue" ta="center">
              {currentUserTotal.toFixed(3)}
            </Text>
          </Stack>
        </Paper>
      )}
      {canManage && <Modal
        opened={unassignedModalOpened}
        onClose={() => setUnassignedModalOpened(false)}
        title="Reviews needing assignment"
        size="xl"
        centered
        radius="lg"
        styles={{ title: { fontWeight: 700 } }}
      >
        <Stack gap="md">
          <Stack gap={4} align="center">
            <Badge color="orange" variant="light" size="lg">
              {summary.unassignedCount} unassigned
            </Badge>
            <Text size="sm" c="dimmed" ta="center" maw={720}>
              These reviews are counted in {dayjs(`${month}-01`).format("MMMM YYYY")}, but no team member has been assigned credit yet.
            </Text>
          </Stack>

          {unassignedReviews.length === 0 ? (
            <Paper withBorder radius="md" p="xl">
              <Text c="dimmed" ta="center">
                {summary.unassignedCount === 0
                  ? "Every counted review for this month has an assignment."
                  : "The review details are not available in the current response. Refresh the page and try again."}
              </Text>
            </Paper>
          ) : (
            <ScrollArea.Autosize mah="65vh" type="auto" offsetScrollbars>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                {unassignedReviews.map((review) => (
                  <Paper key={review.id} withBorder radius="md" p={{ base: "sm", sm: "md" }}>
                    <Stack gap="sm" align="center">
                      <Group gap="xs" justify="center" wrap="wrap">
                        <Badge variant="light">{platformLabel(review.platform)}</Badge>
                        <Badge color="yellow" variant="light">★ {review.rating.toFixed(1)}</Badge>
                        {review.isDeleted && <Badge color="red" variant="light">Deleted after lock</Badge>}
                      </Group>
                      <Stack gap={2} align="center">
                        <Text fw={700} ta="center" style={{ overflowWrap: "anywhere" }}>
                          {review.reviewerName || "Unknown reviewer"}
                        </Text>
                        <Text size="xs" c="dimmed" ta="center">
                          {dayjs(review.reviewCreatedAt).format("D MMM YYYY")} · Counted in {dayjs(`${effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth)}-01`).format("MMMM YYYY")}
                        </Text>
                      </Stack>
                      <Text size="sm" ta="center" style={{ overflowWrap: "anywhere" }}>
                        {review.comment || "No written comment"}
                      </Text>
                    </Stack>
                  </Paper>
                ))}
              </SimpleGrid>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </Modal>}
      <Paper p={{ base: "md", sm: "lg" }} withBorder radius="lg">
        <Box pos="relative" mb="md" mih={36}>
          <Title order={4} ta="center" px={canManage ? 44 : 0}>
            Staff Credit Ledger
          </Title>
          {canManage && (
            <Tooltip label="Add manual counter entry">
              <ActionIcon
                pos="absolute"
                top={0}
                right={0}
                size="lg"
                variant="filled"
                aria-label="Add manual counter entry"
                onClick={() => {
                  setManualError("");
                  setManualModalOpened(true);
                }}
              >
                <IconPlus size={20} />
              </ActionIcon>
            </Tooltip>
          )}
        </Box>
        {summary.staff.length === 0 ? (
          <Text c="dimmed" ta="center" py="lg">No staff credits are recorded for this month.</Text>
        ) : (
          <>
            <Box visibleFrom="sm">
              <Table.ScrollContainer minWidth={760}>
                <Table striped verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th ta="center">Person</Table.Th>
                      <Table.Th ta="center">Reviews</Table.Th>
                      <Table.Th ta="center">Assignment credit</Table.Th>
                      <Table.Th ta="center">Manual additions</Table.Th>
                      <Table.Th ta="center">Total</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.staff.map((staff) => {
                      const userOpen = expandedUsers.has(staff.userId);
                      return (
                        <Fragment key={staff.userId}>
                          <Table.Tr onClick={() => toggleUser(staff.userId)} style={{ cursor: "pointer" }}>
                            <Table.Td fw={600} ta="center">
                              <Group gap="xs" justify="center" wrap="wrap">
                                {userOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                                <span>{staff.name}</span>
                                {staff.deletedReviewCount > 0 && (
                                  <Badge color="red" variant="light" size="sm">
                                    {staff.deletedReviewCount} deleted ref{staff.deletedReviewCount === 1 ? "" : "s"}
                                  </Badge>
                                )}
                              </Group>
                            </Table.Td>
                            <Table.Td ta="center">{staff.reviewCount}</Table.Td>
                            <Table.Td ta="center">{staff.assigned.toFixed(3)}</Table.Td>
                            <Table.Td ta="center">
                              {staff.manual > 0 ? (
                                <Tooltip label="Expand this person to view manual additions">
                                  <Badge color="orange" variant="light">{staff.manual.toFixed(3)}</Badge>
                                </Tooltip>
                              ) : staff.manual.toFixed(3)}
                            </Table.Td>
                            <Table.Td ta="center"><Badge size="lg">{staff.total.toFixed(3)}</Badge></Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td colSpan={5} p={0}>
                              <Collapse in={userOpen}>{renderStaffDetails(staff)}</Collapse>
                            </Table.Td>
                          </Table.Tr>
                        </Fragment>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Box>
            <Stack hiddenFrom="sm" gap="sm">
              {summary.staff.map((staff) => {
                const userOpen = expandedUsers.has(staff.userId);
                return (
                  <Paper key={staff.userId} withBorder radius="md" style={{ overflow: "hidden" }}>
                    <UnstyledButton
                      w="100%"
                      p="md"
                      onClick={() => toggleUser(staff.userId)}
                      aria-expanded={userOpen}
                    >
                      <Stack align="center" gap="sm">
                        <Group gap="xs" justify="center" wrap="wrap">
                          {userOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          <Text fw={700} ta="center">{staff.name}</Text>
                          {staff.deletedReviewCount > 0 && (
                            <Badge color="red" variant="light" size="sm">
                              {staff.deletedReviewCount} deleted ref{staff.deletedReviewCount === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </Group>
                        <SimpleGrid cols={2} spacing="sm" w="100%">
                          <Stack gap={0} align="center">
                            <Text size="xs" c="dimmed">Reviews</Text>
                            <Text fw={700}>{staff.reviewCount}</Text>
                          </Stack>
                          <Stack gap={0} align="center">
                            <Text size="xs" c="dimmed">Assignment credit</Text>
                            <Text fw={700}>{staff.assigned.toFixed(3)}</Text>
                          </Stack>
                          <Stack gap={0} align="center">
                            <Text size="xs" c="dimmed">Manual additions</Text>
                            {staff.manual > 0 ? (
                              <Badge color="orange" variant="light">{staff.manual.toFixed(3)}</Badge>
                            ) : (
                              <Text fw={700}>{staff.manual.toFixed(3)}</Text>
                            )}
                          </Stack>
                          <Stack gap={0} align="center">
                            <Text size="xs" c="dimmed">Total</Text>
                            <Badge size="lg">{staff.total.toFixed(3)}</Badge>
                          </Stack>
                        </SimpleGrid>
                      </Stack>
                    </UnstyledButton>
                    <Collapse in={userOpen}>{renderStaffDetails(staff)}</Collapse>
                  </Paper>
                );
              })}
            </Stack>
          </>
        )}
      </Paper>
      {canManage && <ReviewMonthlySummary month={month} hideDateControls collapsible />}
      {canManage && <DailyReviewTrend snapshots={summary.trendSnapshots ?? []} />}
      <Modal
        opened={Boolean(manualEditTarget)}
        onClose={() => {
          if (!manualEditBusy) {
            setManualEditTarget(null);
            setManualEditError("");
          }
        }}
        title="Edit manual addition"
        size="lg"
        centered
        radius="lg"
        closeOnClickOutside={!manualEditBusy}
        closeOnEscape={!manualEditBusy}
        styles={{ title: { fontWeight: 700 } }}
      >
        <Stack gap="lg">
          <Stack gap={4} align="center">
            <Text size="sm" c="dimmed" ta="center">
              Update this manual addition. Its accounting month remains unchanged.
            </Text>
            <Badge color="gray" variant="light">
              {manualEditTarget
                ? dayjs(`${manualEditTarget.entry.date.slice(0, 7)}-01`).format("MMMM YYYY")
                : ""}
            </Badge>
          </Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <Select
              searchable
              required
              label="Person"
              placeholder="Search for a team member"
              nothingFoundMessage="No team member found"
              data={users.map((user) => ({
                value: String(user.id),
                label: `${user.firstName} ${user.lastName}`.trim() || user.username,
              }))}
              value={manualEditForm.userId}
              onChange={(value) => setManualEditForm((current) => ({ ...current, userId: value ?? "" }))}
            />
            <Select
              required
              label="Platform"
              data={[
                { value: "google", label: "Google" },
                { value: "tripadvisor", label: "TripAdvisor" },
                { value: "airbnb", label: "Airbnb" },
                { value: "getyourguide", label: "GetYourGuide" },
                { value: "manual", label: "Manual / Other" },
              ]}
              value={manualEditForm.platform}
              onChange={(value) => setManualEditForm((current) => ({ ...current, platform: value ?? "manual" }))}
            />
            <NumberInput
              required
              label="Credit amount"
              decimalScale={3}
              min={0.001}
              step={0.25}
              value={manualEditForm.credit}
              onChange={(value) => setManualEditForm((current) => ({ ...current, credit: Number(value) }))}
            />
          </SimpleGrid>
          <Textarea
            label="Description"
            description="Context shown with this manual addition"
            placeholder="Why is this manual adjustment needed?"
            autosize
            minRows={3}
            maxRows={6}
            value={manualEditForm.description}
            onChange={(event) => setManualEditForm((current) => ({
              ...current,
              description: event.currentTarget.value,
            }))}
          />
          {manualEditError && <Text c="red" size="sm" ta="center">{manualEditError}</Text>}
          <Group justify="center" grow>
            <Button
              variant="default"
              disabled={manualEditBusy}
              onClick={() => {
                setManualEditTarget(null);
                setManualEditError("");
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconPencil size={16} />}
              loading={manualEditBusy}
              disabled={
                !manualEditForm.userId ||
                !manualEditForm.platform ||
                !Number.isFinite(manualEditForm.credit) ||
                manualEditForm.credit <= 0
              }
              onClick={() => void updateManualCredit()}
            >
              Save changes
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={Boolean(manualDeleteTarget)}
        onClose={() => {
          if (!manualDeleteBusy) {
            setManualDeleteTarget(null);
            setManualDeleteError("");
          }
        }}
        title="Remove manual addition?"
        centered
        radius="lg"
        closeOnClickOutside={!manualDeleteBusy}
        closeOnEscape={!manualDeleteBusy}
        styles={{ title: { fontWeight: 700 } }}
      >
        <Stack gap="md">
          <Text ta="center">
            Remove this manual review credit from <Text span fw={700}>{manualDeleteTarget?.staffName}</Text>?
          </Text>
          <Group gap="xs" justify="center" wrap="wrap">
            <Badge color="orange" variant="light">
              {manualDeleteTarget ? platformLabel(manualDeleteTarget.platform) : ""}
            </Badge>
            <Badge color="red" variant="light">
              {manualDeleteTarget?.entry.credit.toFixed(3)} credit
            </Badge>
            <Badge color="gray" variant="light">
              {manualDeleteTarget
                ? dayjs(`${manualDeleteTarget.entry.date.slice(0, 7)}-01`).format("MMMM YYYY")
                : ""}
            </Badge>
          </Group>
          <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-gray-0)">
            <Text size="xs" fw={700} c="dimmed" ta="center">Description</Text>
            <Text size="sm" ta="center" style={{ overflowWrap: "anywhere" }}>
              {manualDeleteTarget?.entry.notes || "No description provided"}
            </Text>
          </Paper>
          <Text size="sm" c="dimmed" ta="center">
            The staff and monthly totals will be recalculated immediately. This cannot be undone.
          </Text>
          {manualDeleteError && <Text c="red" size="sm" ta="center">{manualDeleteError}</Text>}
          <Group justify="center" grow>
            <Button
              variant="default"
              disabled={manualDeleteBusy}
              onClick={() => {
                setManualDeleteTarget(null);
                setManualDeleteError("");
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={manualDeleteBusy}
              onClick={() => void removeManualCredit()}
            >
              Remove addition
            </Button>
          </Group>
        </Stack>
      </Modal>
      {canManage && (
        <Modal
          opened={manualModalOpened}
          onClose={() => {
            if (!manualBusy) {
              setManualModalOpened(false);
              setManualError("");
            }
          }}
          title="Add manual counter entry"
          size="lg"
          centered
          radius="lg"
          closeOnClickOutside={!manualBusy}
          closeOnEscape={!manualBusy}
          styles={{ title: { fontWeight: 700 } }}
        >
          <Stack gap="lg">
            <Stack gap={4} align="center">
              <Text size="sm" c="dimmed" ta="center">
                Add an adjustment to the staff ledger for {dayjs(`${month}-01`).format("MMMM YYYY")}.
              </Text>
              <Group gap="xs" justify="center" wrap="wrap">
                <Badge color="gray" variant="light">
                  No name: {summary.manualCategoryTotals?.noName ?? 0}
                </Badge>
                <Badge color="red" variant="light">
                  Bad reviews: {summary.manualCategoryTotals?.bad ?? 0}
                </Badge>
              </Group>
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600} ta="center">Entry type</Text>
              <SegmentedControl
                fullWidth
                value={form.category}
                onChange={(value) => setForm({ ...form, category: value as typeof form.category })}
                data={[
                  { label: "Staff credit", value: "staff" },
                  { label: "No name", value: "no_name" },
                  { label: "Bad review", value: "bad" },
                ]}
              />
              <Text size="xs" c="dimmed" ta="center">
                {form.category === "staff"
                  ? "Assign credit to a specific team member."
                  : form.category === "no_name"
                    ? "Record a review that does not name a team member."
                    : "Record a negative-review adjustment."}
              </Text>
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: form.category === "staff" ? 3 : 2 }} spacing="md">
              {form.category === "staff" && (
                <Select
                  searchable
                  required
                  label="Team member"
                  placeholder="Search for a team member"
                  nothingFoundMessage="No team member found"
                  data={users.map((u) => ({
                    value: String(u.id),
                    label: `${u.firstName} ${u.lastName}`.trim() || u.username,
                  }))}
                  value={form.userId}
                  onChange={(value) => setForm({ ...form, userId: value ?? "" })}
                />
              )}
              <Select
                label="Platform"
                data={[
                  { value: "google", label: "Google" },
                  { value: "tripadvisor", label: "TripAdvisor" },
                  { value: "airbnb", label: "Airbnb" },
                  { value: "getyourguide", label: "GetYourGuide" },
                  { value: "manual", label: "Manual / Other" },
                ]}
                value={form.platform}
                onChange={(value) => setForm({ ...form, platform: value ?? "manual" })}
              />
              <NumberInput
                required
                label="Credit amount"
                decimalScale={3}
                min={0.001}
                step={0.25}
                value={form.credit}
                onChange={(value) => setForm({ ...form, credit: Number(value) })}
              />
            </SimpleGrid>

            <Textarea
              label="Description"
              description="Context shown with this manual addition"
              placeholder="Why is this manual adjustment needed?"
              autosize
              minRows={3}
              maxRows={6}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })}
            />

            {manualError && <Text c="red" size="sm" ta="center">{manualError}</Text>}

            <Flex direction={{ base: "column-reverse", sm: "row" }} justify="flex-end" gap="sm">
              <Button
                variant="default"
                w={{ base: "100%", sm: "auto" }}
                disabled={manualBusy}
                onClick={() => {
                  setManualModalOpened(false);
                  setManualError("");
                }}
              >
                Cancel
              </Button>
              <Button
                w={{ base: "100%", sm: "auto" }}
                leftSection={<IconPlus size={17} />}
                loading={manualBusy}
                onClick={() => void add()}
                disabled={
                  !Number.isFinite(form.credit)
                  || form.credit < 0.001
                  || (form.category === "staff" && !form.userId)
                }
              >
                Add entry
              </Button>
            </Flex>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
