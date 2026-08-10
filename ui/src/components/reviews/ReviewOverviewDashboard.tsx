import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  ActionIcon,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconLock,
  IconLockOpen,
  IconStar,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import { effectiveReviewMonth } from "../../utils/reviewCreditMonth";
import ReviewMonthlySummary from "../reviewCounters/ReviewMonthlySummary";
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
export default function ReviewOverviewDashboard({ canManage = false }: { canManage?: boolean }) {
  const [month, setMonth] = useState(dayjs().subtract(1, "month").format("YYYY-MM"));
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{
    staff: Staff[];
    reviewCount: number;
    deletedCount: number;
    unassignedCount: number;
    manualCategoryTotals?: { noName: number; bad: number };
    lock: MonthLock | null;
  }>({ staff: [], reviewCount: 0, deletedCount: 0, unassignedCount: 0, manualCategoryTotals: { noName: 0, bad: 0 }, lock: null });
  const [users, setUsers] = useState<User[]>([]);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState("");
  const [form, setForm] = useState({
    userId: "",
    category: "staff" as "staff" | "no_name" | "bad",
    platform: "manual",
    credit: 1,
    notes: "",
  });
  const load = useCallback(async () => {
    const start = dayjs(`${month}-01`),
      end = start.endOf("month");
    const [s, a] = await Promise.all([
      axiosInstance.get("/reviews/archive/summary", {
        params: {
          start: start.format("YYYY-MM-DD"),
          end: end.format("YYYY-MM-DD"),
        },
      }),
      axiosInstance.get("/reviews/archive", { params: { deleted: "all" } }),
    ]);
    setSummary(s.data);
    setUsers(a.data.users);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async () => {
    await axiosInstance.post("/reviews/archive/manual-credits", {
      ...form,
      userId: form.category === "staff" ? Number(form.userId) : null,
      date: `${month}-01`,
    });
    setForm({ ...form, credit: 1, notes: "" });
    await load();
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
  const moveMonth = (amount: number) => setMonth(dayjs(`${month}-01`).add(amount, "month").format("YYYY-MM"));
  const toggleUser = (userId: number) => setExpandedUsers(current => { const next = new Set(current); next.has(userId) ? next.delete(userId) : next.add(userId); return next; });
  const togglePlatform = (key: string) => setExpandedPlatforms(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const platformLabel = (platform: string) => ({ google: "Google", tripadvisor: "TripAdvisor", airbnb: "Airbnb", getyourguide: "GetYourGuide", manual: "Manual" }[platform] ?? platform);
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Review performance</Title>
          <Text c="dimmed">
            Credits are calculated directly from archived review assignments.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap">
          <ActionIcon variant="default" size="lg" aria-label="Previous month" onClick={() => moveMonth(-1)}><IconChevronLeft size={18}/></ActionIcon>
          <TextInput type="month" value={month} onChange={(e) => setMonth(e.currentTarget.value)} />
          <ActionIcon variant="default" size="lg" aria-label="Next month" onClick={() => moveMonth(1)}><IconChevronRight size={18}/></ActionIcon>
          {canManage && <Button
            color={summary.lock?.isLocked ? "orange" : "blue"}
            variant={summary.lock?.isLocked ? "light" : "filled"}
            leftSection={summary.lock?.isLocked ? <IconLockOpen size={17}/> : <IconLock size={17}/>}
            loading={lockBusy}
            onClick={() => void toggleMonthLock()}
          >
            {summary.lock?.isLocked ? "Unlock final count" : "Lock final count"}
          </Button>}
        </Group>
      </Group>
      <Paper p="md" withBorder radius="lg" bg={summary.lock?.isLocked ? "var(--mantine-color-green-light)" : "var(--mantine-color-blue-light)"}>
        <Group justify="space-between" align="flex-start">
          <Group gap="sm" wrap="nowrap">
            {summary.lock?.isLocked ? <IconLock size={20}/> : <IconLockOpen size={20}/>}
            <div>
              <Text fw={700}>{summary.lock?.isLocked ? `Final count locked at ${summary.reviewCount}` : "Live review count"}</Text>
              <Text size="sm" c="dimmed">
                {summary.lock?.isLocked
                  ? `Locked${summary.lock.lockedByName ? ` by ${summary.lock.lockedByName}` : ""}${summary.lock.lockedAt ? ` on ${dayjs(summary.lock.lockedAt).format("D MMM YYYY HH:mm")}` : ""}. Reviews deleted after this remain counted until you unlock.`
                  : "Deleted reviews are excluded. Lock this month after your review-checking period to freeze its final count."}
              </Text>
            </div>
          </Group>
        </Group>
        {lockError && <Text c="red" size="sm" mt="xs">{lockError}</Text>}
      </Paper>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {cards.map(([label, value, Icon, color]) => (
          <Paper key={label} p="lg" withBorder radius="lg">
            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                {label}
              </Text>
              <Icon size={20} />
            </Group>
            <Text fz={32} fw={800} c={color}>
              {value}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <ReviewMonthlySummary month={month} hideDateControls />
      <Paper p="lg" withBorder radius="lg">
        <Title order={4} mb="md">
          Staff credit ledger
        </Title>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>Reviews</Table.Th>
              <Table.Th>Assignment credit</Table.Th>
              <Table.Th>Manual additions</Table.Th>
              <Table.Th>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {summary.staff.map((s) => {
              const userOpen = expandedUsers.has(s.userId);
              return <Fragment key={s.userId}>
                <Table.Tr onClick={() => toggleUser(s.userId)} style={{ cursor: "pointer" }}>
                  <Table.Td fw={600}><Group gap="xs" wrap="wrap">{userOpen ? <IconChevronDown size={16}/> : <IconChevronRight size={16}/>}<span>{s.name}</span>{s.deletedReviewCount > 0 && <Badge color="red" variant="light" size="sm">{s.deletedReviewCount} deleted ref{s.deletedReviewCount === 1 ? "" : "s"}</Badge>}</Group></Table.Td>
                  <Table.Td>{s.reviewCount}</Table.Td>
                  <Table.Td>{s.assigned.toFixed(3)}</Table.Td>
                  <Table.Td>{s.manual.toFixed(3)}</Table.Td>
                  <Table.Td><Badge size="lg">{s.total.toFixed(3)}</Badge></Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td colSpan={5} p={0}>
                    <Collapse in={userOpen}>
                      <Stack p="md" gap="xs" bg="var(--mantine-color-gray-0)">
                        {s.platforms.map(platform => {
                          const platformKey = `${s.userId}:${platform.platform}`, platformOpen = expandedPlatforms.has(platformKey);
                          return <Paper key={platform.platform} withBorder radius="md">
                            <Group p="sm" justify="space-between" onClick={() => togglePlatform(platformKey)} style={{ cursor: "pointer" }}>
                              <Group gap="xs">{platformOpen ? <IconChevronDown size={15}/> : <IconChevronRight size={15}/>}<Text fw={700}>{platformLabel(platform.platform)}</Text><Badge variant="light">{platform.reviewCount} reviews</Badge>{platform.deletedReviewCount > 0 && <Badge color="red" variant="light">{platform.deletedReviewCount} deleted ref{platform.deletedReviewCount === 1 ? "" : "s"}</Badge>}</Group>
                              <Group gap="lg"><Text size="sm">Assigned {platform.assigned.toFixed(3)}</Text>{platform.manual > 0 && <Text size="sm">Manual {platform.manual.toFixed(3)}</Text>}<Badge>{platform.total.toFixed(3)}</Badge></Group>
                            </Group>
                            <Collapse in={platformOpen}>
                              <Stack p="sm" pt={0} gap="xs">
                                {platform.reviews.map(review => <Paper key={review.id} p="sm" bg="white" withBorder>
                                  <Group justify="space-between" align="flex-start"><div><Text fw={600}>{review.reviewerName}</Text><Text size="xs" c="dimmed">Counted in {dayjs(`${effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth)}-01`).format("MMMM YYYY")} · Credit {review.credit.toFixed(3)}</Text></div><Group gap="xs"><Badge color="yellow">★ {review.rating.toFixed(1)}</Badge>{review.isDeleted && <Badge color="red">Deleted later · Still counted</Badge>}</Group></Group>
                                  <Text size="sm" mt="xs">{review.comment || "No written comment"}</Text>
                                </Paper>)}
                                {(platform.deletedReviews ?? []).length > 0 && <>
                                  <Text size="xs" fw={700} c="red" mt="xs">Deleted references — excluded from counts, targets, and payments</Text>
                                  {(platform.deletedReviews ?? []).map(review => <Paper key={`deleted-${review.id}`} p="sm" bg="var(--mantine-color-red-0)" withBorder>
                                    <Group justify="space-between" align="flex-start"><div><Text fw={600}>{review.reviewerName}</Text><Text size="xs" c="dimmed">Originally assigned to {dayjs(`${effectiveReviewMonth(review.reviewCreatedAt, review.creditMonth)}-01`).format("MMMM YYYY")}</Text></div><Group gap="xs"><Badge color="yellow">★ {review.rating.toFixed(1)}</Badge><Badge color="red">Deleted · Not counted</Badge></Group></Group>
                                    <Text size="sm" mt="xs">{review.comment || "No written comment"}</Text>
                                  </Paper>)}
                                </>}
                                {platform.manualEntries.map(entry => <Paper key={`manual-${entry.id}`} p="sm" bg="white" withBorder><Group justify="space-between"><div><Text fw={600}>Manual addition</Text><Text size="xs" c="dimmed">{dayjs(entry.date).format("D MMM YYYY")}</Text></div><Badge>{entry.credit.toFixed(3)}</Badge></Group>{entry.notes && <Text size="sm" mt="xs">{entry.notes}</Text>}</Paper>)}
                              </Stack>
                            </Collapse>
                          </Paper>;
                        })}
                      </Stack>
                    </Collapse>
                  </Table.Td>
                </Table.Tr>
              </Fragment>;
            })}
          </Table.Tbody>
        </Table>
      </Paper>
      {canManage && <Paper p="lg" withBorder radius="lg">
        <Title order={4}>Manual counter addition</Title>
        <Text size="sm" c="dimmed" mb="md">
          Add staff credit or record a No name or Bad review counter adjustment.
        </Text>
        <Group mb="md"><Badge color="gray" variant="light">Manual no name: {summary.manualCategoryTotals?.noName ?? 0}</Badge><Badge color="red" variant="light">Manual bad reviews: {summary.manualCategoryTotals?.bad ?? 0}</Badge></Group>
        <Group mb="md"><Checkbox label="No name" color="gray" checked={form.category === "no_name"} onChange={(event) => setForm({ ...form, category: event.currentTarget.checked ? "no_name" : "staff" })}/><Checkbox label="Bad review" color="red" checked={form.category === "bad"} onChange={(event) => setForm({ ...form, category: event.currentTarget.checked ? "bad" : "staff" })}/></Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            searchable
            label="User"
            description={form.category === "staff" ? "Required for staff credit" : "Not used for No name or Bad review"}
            disabled={form.category !== "staff"}
            data={users.map((u) => ({
              value: String(u.id),
              label: `${u.firstName} ${u.lastName}`.trim() || u.username,
            }))}
            value={form.userId}
            onChange={(v) => setForm({ ...form, userId: v ?? "" })}
          />
          <Select
            label="Platform"
            data={["google", "tripadvisor", "airbnb", "getyourguide", "manual"]}
            value={form.platform}
            onChange={(v) => setForm({ ...form, platform: v ?? "manual" })}
          />
          <NumberInput
            label="Credit"
            decimalScale={3}
            min={0.001}
            value={form.credit}
            onChange={(v) => setForm({ ...form, credit: Number(v) })}
          />
        </SimpleGrid>
        <Textarea
          mt="sm"
          label="Reason"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
        />
        <Button mt="md" onClick={add} disabled={form.category === "staff" && !form.userId}>
          Add counter entry
        </Button>
      </Paper>}
    </Stack>
  );
}
