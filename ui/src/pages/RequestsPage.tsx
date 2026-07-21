import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  JsonInput,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowsExchange,
  IconCheck,
  IconClipboardList,
  IconCurrencyZloty,
  IconRefresh,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { navigateToPage } from "../actions/navigationActions";
import {
  useApproveUserRequest,
  useDecideFinanceRequest,
  useDecideScheduleSwapRequest,
  useRejectUserRequest,
  useRequestsCenter,
  type UserApprovalRequest,
} from "../api/requests";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useAppDispatch } from "../store/hooks";
import type { FinanceManagementRequest } from "../types/finance";
import type { ShiftAssignment, SwapRequest } from "../types/scheduling";

const PAGE_SLUG = PAGE_SLUGS.requests;

const formatDateTime = (value?: string | Date | null): string => {
  if (!value) {
    return "Unknown";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY HH:mm") : String(value);
};

const formatDate = (value?: string | Date | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : String(value);
};

const normalizeText = (value?: string | null): string => (value ?? "").trim();

const formatUserName = (user: { firstName?: string | null; lastName?: string | null; username?: string | null; id?: number } | null | undefined) => {
  const fullName = `${normalizeText(user?.firstName)} ${normalizeText(user?.lastName)}`.trim();
  if (fullName) {
    return fullName;
  }
  if (user?.username) {
    return user.username;
  }
  return user?.id ? `User #${user.id}` : "Unknown user";
};

const formatRequestedUserType = (value?: string | null): string => {
  const normalized = normalizeText(value).replace(/[_-]+/g, " ");
  if (!normalized) {
    return "Not specified";
  }
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
};

const describeShift = (assignment: ShiftAssignment | null | undefined): string => {
  const shift = assignment?.shiftInstance;
  if (!shift) {
    return "Shift details unavailable";
  }

  const date = shift.date ? dayjs(shift.date).format("ddd, MMM D") : "Unknown date";
  const type = shift.shiftType?.name ?? "Shift";
  const start = shift.timeStart ?? "?";
  const end = shift.timeEnd ? ` - ${shift.timeEnd}` : "";
  const role = assignment.roleInShift || "Role not specified";
  return `${date} - ${type} - ${start}${end} - ${role}`;
};

const RequestMetric = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "orange" | "green";
}) => (
  <Paper withBorder radius="md" p="lg" style={{ textAlign: "center" }}>
    <Stack gap={4} align="center">
      <Badge color={tone} variant="light">
        {label}
      </Badge>
      <Text fw={800} fz={28}>
        {value}
      </Text>
    </Stack>
  </Paper>
);

const SectionHeader = ({
  icon,
  title,
  count,
}: {
  icon: ReactNode;
  title: string;
  count: number;
}) => (
  <Group justify="space-between" align="center">
    <Group gap="sm">
      <ThemeIcon variant="light" radius="xl" color="blue">
        {icon}
      </ThemeIcon>
      <Title order={3}>{title}</Title>
    </Group>
    <Badge size="lg" color={count > 0 ? "orange" : "gray"} variant="light">
      {count}
    </Badge>
  </Group>
);

const UserApprovalCard = ({
  user,
  busyUserId,
  onApprove,
  onReject,
}: {
  user: UserApprovalRequest;
  busyUserId: number | null;
  onApprove: (user: UserApprovalRequest) => void;
  onReject: (user: UserApprovalRequest) => void;
}) => {
  const roleLabel = user.role?.name ?? formatRequestedUserType(user.requestedUserType);
  const shiftRoleLabel = user.shiftRoles?.length
    ? user.shiftRoles.map((role) => role.name).join(", ")
    : "No shift roles selected";
  const staffProfile = user.staffProfile;
  const isBusy = busyUserId === user.id;

  return (
    <Card withBorder radius="md" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text fw={800} fz="lg">
              {formatUserName(user)}
            </Text>
            <Text size="sm" c="dimmed">
              @{user.username || "no-username"} - {normalizeText(user.email) || "No email"}
            </Text>
          </Stack>
          <Badge color="orange" variant="light">
            Signup
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Requested type
            </Text>
            <Text fw={600}>{roleLabel}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Shift roles
            </Text>
            <Text fw={600}>{shiftRoleLabel}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Stay
            </Text>
            <Text fw={600}>
              {formatDate(user.arrivalDate) ?? "-"} to {formatDate(user.departureDate) ?? "-"}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Staff setup
            </Text>
            <Text fw={600}>
              {staffProfile?.staffType ? formatRequestedUserType(staffProfile.staffType) : "Not specified"}
              {staffProfile?.livesInAccom ? " - Lives in accom" : ""}
            </Text>
          </Stack>
        </SimpleGrid>

        <Divider />

        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">
            Requested {formatDateTime(user.createdAt)}
          </Text>
          <Group gap="xs">
            <Button
              color="red"
              variant="light"
              leftSection={<IconX size={16} />}
              loading={isBusy}
              onClick={() => onReject(user)}
            >
              Reject
            </Button>
            <Button
              color="green"
              leftSection={<IconCheck size={16} />}
              loading={isBusy}
              onClick={() => onApprove(user)}
            >
              Approve
            </Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
};

const ScheduleSwapCard = ({
  swap,
  busySwapId,
  onDecision,
}: {
  swap: SwapRequest;
  busySwapId: number | null;
  onDecision: (swap: SwapRequest, approve: boolean) => void;
}) => {
  const isBusy = busySwapId === swap.id;
  return (
    <Card withBorder radius="md" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={800} fz="lg">
              Swap request #{swap.id}
            </Text>
            <Text size="sm" c="dimmed">
              {formatUserName(swap.requester)} with {formatUserName(swap.partner)}
            </Text>
          </Stack>
          <Badge color="blue" variant="light">
            Schedule
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <Paper withBorder radius="md" p="md">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                From
              </Text>
              <Text fw={600}>{describeShift(swap.fromAssignment)}</Text>
            </Stack>
          </Paper>
          <Paper withBorder radius="md" p="md">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                To
              </Text>
              <Text fw={600}>{describeShift(swap.toAssignment)}</Text>
            </Stack>
          </Paper>
        </SimpleGrid>

        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">
            Requested {formatDateTime(swap.createdAt)}
          </Text>
          <Group gap="xs">
            <Button
              color="red"
              variant="light"
              leftSection={<IconX size={16} />}
              loading={isBusy}
              onClick={() => onDecision(swap, false)}
            >
              Deny
            </Button>
            <Button
              color="green"
              leftSection={<IconCheck size={16} />}
              loading={isBusy}
              onClick={() => onDecision(swap, true)}
            >
              Approve
            </Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
};

const FinanceRequestCard = ({
  request,
  onOpen,
}: {
  request: FinanceManagementRequest;
  onOpen: (request: FinanceManagementRequest) => void;
}) => (
  <Card withBorder radius="md" p="lg">
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Text fw={800} fz="lg">
            Finance request #{request.id}
          </Text>
          <Text size="sm" c="dimmed">
            {request.type} - {request.targetEntity}
            {request.targetId ? ` #${request.targetId}` : ""}
          </Text>
        </Stack>
        <Group gap={6}>
          <Badge color={request.priority === "high" ? "red" : request.priority === "normal" ? "yellow" : "gray"} variant="light">
            {request.priority}
          </Badge>
          <Badge color={request.status === "open" ? "orange" : "blue"} variant="light">
            {request.status}
          </Badge>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        Requested {formatDateTime(request.createdAt)}
        {request.dueAt ? ` - Due ${formatDate(request.dueAt)}` : ""}
      </Text>
      <Button variant="light" onClick={() => onOpen(request)}>
        Review
      </Button>
    </Stack>
  </Card>
);

const RequestsPage = () => {
  const dispatch = useAppDispatch();
  const requestsQuery = useRequestsCenter();
  const approveUser = useApproveUserRequest();
  const rejectUser = useRejectUserRequest();
  const decideSwap = useDecideScheduleSwapRequest();
  const decideFinance = useDecideFinanceRequest();
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [busySwapId, setBusySwapId] = useState<number | null>(null);
  const [financeModal, setFinanceModal] = useState<FinanceManagementRequest | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(navigateToPage("Requests"));
  }, [dispatch]);

  const data = requestsQuery.data;
  const summary = data?.summary ?? {
    total: 0,
    userApprovals: 0,
    scheduleSwaps: 0,
    financeRequests: 0,
  };

  const isDecisionBusy = approveUser.isPending || rejectUser.isPending || decideSwap.isPending || decideFinance.isPending;

  const sortedFinanceRequests = useMemo(
    () =>
      [...(data?.financeRequests ?? [])].sort((a, b) => {
        const priority = { high: 0, normal: 1, low: 2 } as const;
        const priorityDiff = priority[a.priority] - priority[b.priority];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
    [data?.financeRequests],
  );

  const handleApproveUser = async (user: UserApprovalRequest) => {
    setBusyUserId(user.id);
    setPageError(null);
    try {
      await approveUser.mutateAsync({ userId: user.id, userTypeId: user.userTypeId ?? null });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Unable to approve user request");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRejectUser = async (user: UserApprovalRequest) => {
    setBusyUserId(user.id);
    setPageError(null);
    try {
      await rejectUser.mutateAsync({ userId: user.id });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Unable to reject user request");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleSwapDecision = async (swap: SwapRequest, approve: boolean) => {
    setBusySwapId(swap.id);
    setPageError(null);
    try {
      await decideSwap.mutateAsync({ swapId: swap.id, approve });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Unable to update swap request");
    } finally {
      setBusySwapId(null);
    }
  };

  const handleFinanceDecision = async (action: "approve" | "return" | "reject") => {
    if (!financeModal) {
      return;
    }
    setPageError(null);
    try {
      await decideFinance.mutateAsync({
        requestId: financeModal.id,
        action,
        decisionNote: decisionNote.trim() || null,
      });
      setFinanceModal(null);
      setDecisionNote("");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Unable to update finance request");
    }
  };

  const content = (
    <Stack gap="xl">
      <Card withBorder radius="lg" p={{ base: "lg", md: "xl" }}>
        <Stack gap="lg">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm">
              <ThemeIcon size={44} radius="xl" color="blue" variant="light">
                <IconClipboardList size={24} />
              </ThemeIcon>
              <Stack gap={0}>
                <Title order={2}>Requests</Title>
                <Text c="dimmed">One place for approvals that need a manager decision.</Text>
              </Stack>
            </Group>
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={() => requestsQuery.refetch()}
              loading={requestsQuery.isFetching}
            >
              Refresh
            </Button>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            <RequestMetric label="Total open" value={summary.total} tone="blue" />
            <RequestMetric label="Users" value={summary.userApprovals} tone="orange" />
            <RequestMetric label="Swaps" value={summary.scheduleSwaps} tone="green" />
            <RequestMetric label="Finance" value={summary.financeRequests} tone="blue" />
          </SimpleGrid>
        </Stack>
      </Card>

      {pageError ? (
        <Alert color="red" title="Request action failed" onClose={() => setPageError(null)} withCloseButton>
          {pageError}
        </Alert>
      ) : null}

      {requestsQuery.isError ? (
        <Alert color="red" title="Unable to load requests">
          {requestsQuery.error instanceof Error ? requestsQuery.error.message : "Unexpected error"}
        </Alert>
      ) : null}

      {requestsQuery.isLoading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
          <Text c="dimmed">Loading requests...</Text>
        </Group>
      ) : null}

      {!requestsQuery.isLoading && data ? (
        <>
          <Stack gap="md">
            <SectionHeader icon={<IconUserCheck size={18} />} title="User Approvals" count={data.userApprovals.length} />
            {data.userApprovals.length === 0 ? (
              <Paper withBorder radius="md" p="lg">
                <Text ta="center" c="dimmed">
                  No user approvals waiting.
                </Text>
              </Paper>
            ) : (
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                {data.userApprovals.map((user) => (
                  <UserApprovalCard
                    key={user.id}
                    user={user}
                    busyUserId={busyUserId}
                    onApprove={handleApproveUser}
                    onReject={handleRejectUser}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>

          <Stack gap="md">
            <SectionHeader icon={<IconArrowsExchange size={18} />} title="Schedule Swaps" count={data.scheduleSwaps.length} />
            {data.scheduleSwaps.length === 0 ? (
              <Paper withBorder radius="md" p="lg">
                <Text ta="center" c="dimmed">
                  No schedule swaps waiting for manager approval.
                </Text>
              </Paper>
            ) : (
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                {data.scheduleSwaps.map((swap) => (
                  <ScheduleSwapCard
                    key={swap.id}
                    swap={swap}
                    busySwapId={busySwapId}
                    onDecision={handleSwapDecision}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>

          <Stack gap="md">
            <SectionHeader icon={<IconCurrencyZloty size={18} />} title="Finance Requests" count={sortedFinanceRequests.length} />
            {sortedFinanceRequests.length === 0 ? (
              <Paper withBorder radius="md" p="lg">
                <Text ta="center" c="dimmed">
                  No finance requests waiting.
                </Text>
              </Paper>
            ) : (
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                {sortedFinanceRequests.map((request) => (
                  <FinanceRequestCard key={request.id} request={request} onOpen={setFinanceModal} />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </>
      ) : null}

      <Modal
        opened={Boolean(financeModal)}
        onClose={() => {
          setFinanceModal(null);
          setDecisionNote("");
        }}
        title={financeModal ? `Finance request #${financeModal.id}` : "Finance request"}
        size="xl"
        centered
      >
        {financeModal ? (
          <Stack gap="md">
            <Group gap="xs">
              <Badge color="blue" variant="light">
                {financeModal.type}
              </Badge>
              <Badge variant="light">{financeModal.targetEntity}</Badge>
              <Badge color={financeModal.priority === "high" ? "red" : "gray"} variant="light">
                {financeModal.priority}
              </Badge>
            </Group>
            <JsonInput
              label="Request payload"
              value={JSON.stringify(financeModal.payload, null, 2)}
              minRows={8}
              autosize
              readOnly
              validationError="Invalid JSON"
            />
            <Textarea
              label="Decision note"
              placeholder="Optional note"
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.currentTarget.value)}
              minRows={2}
            />
            <Group justify="space-between">
              <Button
                variant="default"
                onClick={() => {
                  setFinanceModal(null);
                  setDecisionNote("");
                }}
                disabled={isDecisionBusy}
              >
                Close
              </Button>
              <Group gap="xs">
                <Button
                  color="orange"
                  variant="light"
                  loading={decideFinance.isPending}
                  onClick={() => handleFinanceDecision("return")}
                >
                  Return
                </Button>
                <Button
                  color="red"
                  variant="light"
                  loading={decideFinance.isPending}
                  onClick={() => handleFinanceDecision("reject")}
                >
                  Reject
                </Button>
                <Button
                  color="green"
                  loading={decideFinance.isPending}
                  onClick={() => handleFinanceDecision("approve")}
                >
                  Approve
                </Button>
              </Group>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  );

  return <PageAccessGuard pageSlug={PAGE_SLUG}>{content}</PageAccessGuard>;
};

export default RequestsPage;
