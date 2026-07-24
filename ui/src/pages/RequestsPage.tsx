import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
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
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  ScrollArea,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowsExchange,
  IconCheck,
  IconClipboardList,
  IconCurrencyZloty,
  IconPlus,
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
  type PopupRequestAudit,
  type PopupRequestRecipient,
  type UserApprovalRequest,
} from "../api/requests";
import { useCreateRequiredAction, type CreateRequiredActionPayload } from "../api/requiredActions";
import { useCerebroBootstrap } from "../api/cerebro";
import axiosInstance from "../utils/axiosInstance";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useAppDispatch } from "../store/hooks";
import type { FinanceManagementRequest } from "../types/finance";
import type { ShiftAssignment, SwapRequest } from "../types/scheduling";
import type { User } from "../types/users/User";
import type { UserType } from "../types/userTypes/UserType";
import type { ShiftRole } from "../types/shiftRoles/ShiftRole";
import type { ServerResponse } from "../types/general/ServerResponse";

const PAGE_SLUG = PAGE_SLUGS.requests;

const REQUIRED_ACTION_TYPE_OPTIONS: Array<{ value: CreateRequiredActionPayload["type"]; label: string }> = [
  { value: "broadcast", label: "Broadcast message" },
  { value: "policy_consent", label: "Policy consent" },
  { value: "profile_fields", label: "Fill user fields" },
  { value: "quiz", label: "Quiz" },
  { value: "custom", label: "Custom acknowledgement" },
];

const REQUIRED_PROFILE_FIELD_OPTIONS = [
  { value: "profilePhoto", label: "Profile photo" },
  { value: "phone", label: "Phone number" },
  { value: "countryOfCitizenship", label: "Country" },
  { value: "dateOfBirth", label: "Date of birth" },
  { value: "preferredPronouns", label: "Preferred pronouns" },
  { value: "emergencyContactName", label: "Emergency contact name" },
  { value: "emergencyContactRelationship", label: "Emergency contact relationship" },
  { value: "emergencyContactPhone", label: "Emergency contact phone" },
  { value: "emergencyContactEmail", label: "Emergency contact email" },
  { value: "arrivalDate", label: "Arrival date" },
  { value: "departureDate", label: "Departure date" },
  { value: "dietaryRestrictions", label: "Dietary restrictions" },
  { value: "allergies", label: "Allergies" },
  { value: "medicalNotes", label: "Medical notes" },
  { value: "whatsappHandle", label: "WhatsApp number" },
  { value: "facebookProfileUrl", label: "Facebook user" },
  { value: "instagramProfileUrl", label: "Instagram user" },
];

const STAFF_PROFILE_TYPE_OPTIONS = [
  { value: "volunteer", label: "Volunteer" },
  { value: "long_term", label: "Long term" },
  { value: "assistant_manager", label: "Assistant manager" },
  { value: "manager", label: "Manager" },
  { value: "guide", label: "Guide" },
];

const extractServerRows = <T,>(response: ServerResponse<Partial<T>>): Partial<T>[] =>
  response?.[0]?.data ?? [];

const usePopupTargetOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ["popup-request-target-options"],
    enabled,
    queryFn: async () => {
      const [usersResponse, userTypesResponse, shiftRolesResponse] = await Promise.all([
        axiosInstance.get<ServerResponse<Partial<User>>>("/users/active", { withCredentials: true }),
        axiosInstance.get<ServerResponse<Partial<UserType>>>("/userTypes", { withCredentials: true }),
        axiosInstance.get<ServerResponse<Partial<ShiftRole>>>("/shiftRoles", { withCredentials: true }),
      ]);

      return {
        users: extractServerRows<User>(usersResponse.data),
        userTypes: extractServerRows<UserType>(userTypesResponse.data),
        shiftRoles: extractServerRows<ShiftRole>(shiftRolesResponse.data),
      };
    },
  });

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

const formatOptionalDateTime = (value?: string | Date | null): string => {
  if (!value) {
    return "-";
  }
  return formatDateTime(value);
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

const getPopupRecipientStatusLabel = (status: PopupRequestRecipient["status"]): string => {
  if (status === "not_opened") {
    return "Not opened";
  }
  if (status === "prompted") {
    return "Prompted, no action";
  }
  if (status === "dismissed") {
    return "Dismissed";
  }
  return "Completed";
};

const getPopupRecipientStatusColor = (status: PopupRequestRecipient["status"]): string => {
  if (status === "not_opened") {
    return "gray";
  }
  if (status === "prompted") {
    return "orange";
  }
  if (status === "dismissed") {
    return "red";
  }
  return "green";
};

const formatPopupRequestType = (value: string): string =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const toNumberTargets = (values: string[]): number[] | null => {
  const ids = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return ids.length > 0 ? ids : null;
};

const toStringTargets = (values: string[]): string[] | null => {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
};

const getSignatureDataUrl = (response?: Record<string, unknown>): string | null => {
  const signature = response?.eSignature;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    return null;
  }
  const dataUrl = (signature as Record<string, unknown>).dataUrl;
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : null;
};

const stringifyPopupResponse = (response: Record<string, unknown>): string =>
  JSON.stringify(
    response,
    (key, value) => {
      if (key === "dataUrl" && typeof value === "string" && value.startsWith("data:image/")) {
        return "[signature image]";
      }
      return value;
    },
    2,
  );

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

const PopupCountBox = ({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "orange" | "green" | "gray";
}) => (
  <Paper withBorder radius="md" p="sm" bg={`${color}.0`} style={{ textAlign: "center" }}>
    <Text size="xs" fw={800} c={`${color}.8`} tt="uppercase">
      {label}
    </Text>
    <Text fw={900} fz="xl">
      {value}
    </Text>
  </Paper>
);

const PopupRequestMobileCard = ({
  request,
  onDetails,
}: {
  request: PopupRequestAudit;
  onDetails: (request: PopupRequestAudit) => void;
}) => (
  <Card withBorder radius="xl" p="md" shadow="sm">
    <Stack gap="md" align="center" ta="center">
      <Group gap="xs" justify="center">
        <Badge variant="light" color={request.status ? "green" : "gray"} size="lg">
          {request.status ? "Active" : "Inactive"}
        </Badge>
        <Badge variant="light" size="lg">
          {formatPopupRequestType(request.type)}
        </Badge>
        {request.requiresSignature ? (
          <Badge color="grape" variant="light" size="lg">
            Signature
          </Badge>
        ) : null}
      </Group>
      <Stack gap={4} align="center">
        <Title order={4}>{request.title}</Title>
        {request.body ? (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {request.body}
          </Text>
        ) : null}
        <Text size="xs" c="dimmed">
          Created {formatDateTime(request.createdAt)}
        </Text>
      </Stack>
      <SimpleGrid cols={2} spacing="xs" w="100%">
        <PopupCountBox label="Sent" value={request.sentCount} color="blue" />
        <PopupCountBox label="Not opened" value={request.notOpenedCount} color={request.notOpenedCount > 0 ? "orange" : "gray"} />
        <PopupCountBox label="Ignored" value={request.promptedCount} color={request.promptedCount > 0 ? "orange" : "gray"} />
        <PopupCountBox label="Completed" value={request.completedCount} color={request.completedCount > 0 ? "green" : "gray"} />
      </SimpleGrid>
      <Button fullWidth size="md" variant="light" onClick={() => onDetails(request)}>
        View details
      </Button>
    </Stack>
  </Card>
);

const PopupRecipientMobileCard = ({
  recipient,
}: {
  recipient: PopupRequestRecipient;
}) => {
  const signatureDataUrl = getSignatureDataUrl(recipient.response);
  return (
    <Card withBorder radius="lg" p="md" shadow="xs">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text fw={900}>{recipient.name}</Text>
            {recipient.email ? (
              <Text size="xs" c="dimmed">
                {recipient.email}
              </Text>
            ) : null}
          </Stack>
          <Badge color={getPopupRecipientStatusColor(recipient.status)} variant="light">
            {getPopupRecipientStatusLabel(recipient.status)}
          </Badge>
        </Group>
        <SimpleGrid cols={2} spacing="xs">
          <PopupCountBox label="Prompted" value={recipient.promptCount} color={recipient.promptCount > 0 ? "orange" : "gray"} />
          <Paper withBorder radius="md" p="sm" style={{ textAlign: "center" }}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase">
              Completed
            </Text>
            <Text fw={800} size="sm">
              {formatOptionalDateTime(recipient.completedAt)}
            </Text>
          </Paper>
        </SimpleGrid>
        <Paper withBorder radius="md" p="sm" bg="gray.0">
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                First prompted
              </Text>
              <Text size="xs" fw={700}>
                {formatOptionalDateTime(recipient.promptedAt)}
              </Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Last prompted
              </Text>
              <Text size="xs" fw={700}>
                {formatOptionalDateTime(recipient.lastPromptedAt)}
              </Text>
            </Group>
          </Stack>
        </Paper>
        {recipient.response && Object.keys(recipient.response).length > 0 ? (
          <Stack gap="xs">
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt={`${recipient.name} signature`}
                style={{
                  width: "100%",
                  height: 90,
                  objectFit: "contain",
                  border: "1px solid #d7e0ea",
                  borderRadius: 10,
                  background: "#ffffff",
                }}
              />
            ) : null}
            <Text
              component="pre"
              size="xs"
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "Fira Code, monospace",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: 10,
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {stringifyPopupResponse(recipient.response)}
            </Text>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
};

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
  const isMobile = useMediaQuery("(max-width: 48em)");
  const requestsQuery = useRequestsCenter();
  const approveUser = useApproveUserRequest();
  const rejectUser = useRejectUserRequest();
  const decideSwap = useDecideScheduleSwapRequest();
  const decideFinance = useDecideFinanceRequest();
  const createRequiredAction = useCreateRequiredAction();
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [busySwapId, setBusySwapId] = useState<number | null>(null);
  const [financeModal, setFinanceModal] = useState<FinanceManagementRequest | null>(null);
  const [requiredActionModalOpen, setRequiredActionModalOpen] = useState(false);
  const cerebroQuery = useCerebroBootstrap({ enabled: requiredActionModalOpen });
  const [requiredActionType, setRequiredActionType] = useState<CreateRequiredActionPayload["type"]>("broadcast");
  const [requiredActionTitle, setRequiredActionTitle] = useState("");
  const [requiredActionBody, setRequiredActionBody] = useState("");
  const [requiredActionFields, setRequiredActionFields] = useState<string[]>([]);
  const [requiredActionRequiresSignature, setRequiredActionRequiresSignature] = useState(false);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [targetUserTypeIds, setTargetUserTypeIds] = useState<string[]>([]);
  const [targetShiftRoleIds, setTargetShiftRoleIds] = useState<string[]>([]);
  const [targetStaffProfileTypes, setTargetStaffProfileTypes] = useState<string[]>([]);
  const [requiredActionPolicyId, setRequiredActionPolicyId] = useState<string | null>(null);
  const [requiredActionQuizId, setRequiredActionQuizId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [popupDetail, setPopupDetail] = useState<PopupRequestAudit | null>(null);
  const targetOptionsQuery = usePopupTargetOptions(requiredActionModalOpen);

  useEffect(() => {
    dispatch(navigateToPage("Requests"));
  }, [dispatch]);

  useEffect(() => {
    if (requiredActionType !== "policy_consent" || requiredActionTitle.trim() || !requiredActionPolicyId) {
      return;
    }
    const selected = cerebroQuery.data?.entries.find((entry) => entry.id === Number(requiredActionPolicyId));
    if (selected) {
      setRequiredActionTitle(selected.title);
    }
  }, [cerebroQuery.data?.entries, requiredActionPolicyId, requiredActionTitle, requiredActionType]);

  useEffect(() => {
    if (requiredActionType !== "quiz" || requiredActionTitle.trim() || !requiredActionQuizId) {
      return;
    }
    const selected = cerebroQuery.data?.quizzes.find((quiz) => quiz.id === Number(requiredActionQuizId));
    if (selected) {
      setRequiredActionTitle(selected.title);
    }
  }, [cerebroQuery.data?.quizzes, requiredActionQuizId, requiredActionTitle, requiredActionType]);

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

  const cerebroPolicyOptions = useMemo(
    () =>
      (cerebroQuery.data?.entries ?? [])
        .filter((entry) => entry.requiresAcknowledgement && entry.status)
        .map((entry) => ({ value: String(entry.id), label: entry.title })),
    [cerebroQuery.data?.entries],
  );

  const cerebroQuizOptions = useMemo(
    () =>
      (cerebroQuery.data?.quizzes ?? [])
        .filter((quiz) => quiz.status)
        .map((quiz) => ({ value: String(quiz.id), label: quiz.title })),
    [cerebroQuery.data?.quizzes],
  );

  const targetUserOptions = useMemo(
    () =>
      (targetOptionsQuery.data?.users ?? [])
        .filter((user) => Number.isInteger(user.id))
        .map((user) => ({
          value: String(user.id),
          label: formatUserName(user),
        })),
    [targetOptionsQuery.data?.users],
  );

  const targetUserTypeOptions = useMemo(
    () =>
      (targetOptionsQuery.data?.userTypes ?? [])
        .filter((userType) => Number.isInteger(userType.id))
        .map((userType) => ({
          value: String(userType.id),
          label: userType.name ?? `User type #${userType.id}`,
        })),
    [targetOptionsQuery.data?.userTypes],
  );

  const targetShiftRoleOptions = useMemo(
    () =>
      (targetOptionsQuery.data?.shiftRoles ?? [])
        .filter((role) => Number.isInteger(role.id))
        .map((role) => ({
          value: String(role.id),
          label: role.name ?? `Shift role #${role.id}`,
        })),
    [targetOptionsQuery.data?.shiftRoles],
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

  const handleCreateRequiredAction = async () => {
    const title = requiredActionTitle.trim();
    if (!title) {
      setPageError("A popup request title is required");
      return;
    }
    if (requiredActionType === "profile_fields" && requiredActionFields.length === 0) {
      setPageError("Choose at least one user field to request");
      return;
    }
    if (requiredActionType === "policy_consent" && !requiredActionPolicyId) {
      setPageError("Choose the Cerebro policy that users need to accept");
      return;
    }
    if (requiredActionType === "quiz" && !requiredActionQuizId) {
      setPageError("Choose the Cerebro quiz that users need to pass");
      return;
    }

    setPageError(null);
    const requiredActionPayload =
      requiredActionType === "profile_fields"
        ? { fields: requiredActionFields }
        : requiredActionType === "policy_consent"
          ? { cerebroEntryId: Number(requiredActionPolicyId) }
          : requiredActionType === "quiz"
            ? { cerebroQuizId: Number(requiredActionQuizId) }
            : {};

    try {
      await createRequiredAction.mutateAsync({
        type: requiredActionType,
        title,
        body: requiredActionBody.trim() || null,
        payload: requiredActionPayload,
        targetUserIds: toNumberTargets(targetUserIds),
        targetUserTypeIds: toNumberTargets(targetUserTypeIds),
        targetShiftRoleIds: toNumberTargets(targetShiftRoleIds),
        targetStaffProfileTypes: toStringTargets(targetStaffProfileTypes),
        requiresCompletion: true,
        requiresSignature: requiredActionRequiresSignature,
      });
      setRequiredActionModalOpen(false);
      setRequiredActionType("broadcast");
      setRequiredActionTitle("");
      setRequiredActionBody("");
      setRequiredActionFields([]);
      setRequiredActionRequiresSignature(false);
      setTargetUserIds([]);
      setTargetUserTypeIds([]);
      setTargetShiftRoleIds([]);
      setTargetStaffProfileTypes([]);
      setRequiredActionPolicyId(null);
      setRequiredActionQuizId(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Unable to create popup request");
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
            <Group gap="xs">
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => setRequiredActionModalOpen(true)}
              >
                New popup request
              </Button>
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                onClick={() => requestsQuery.refetch()}
                loading={requestsQuery.isFetching}
              >
                Refresh
              </Button>
            </Group>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="md">
            <RequestMetric label="Total open" value={summary.total} tone="blue" />
            <RequestMetric label="Users" value={summary.userApprovals} tone="orange" />
            <RequestMetric label="Swaps" value={summary.scheduleSwaps} tone="green" />
            <RequestMetric label="Finance" value={summary.financeRequests} tone="blue" />
            <RequestMetric label="Popup requests" value={summary.popupRequests ?? data?.popupRequests.length ?? 0} tone="orange" />
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
            <SectionHeader icon={<IconClipboardList size={18} />} title="Popup Requests" count={data.popupRequests.length} />
            {data.popupRequests.length === 0 ? (
              <Paper withBorder radius="md" p="lg">
                <Text ta="center" c="dimmed">
                  No popup requests have been created yet.
                </Text>
              </Paper>
            ) : (
              isMobile ? (
                <Stack gap="sm">
                  {data.popupRequests.map((request) => (
                    <PopupRequestMobileCard key={request.id} request={request} onDetails={setPopupDetail} />
                  ))}
                </Stack>
              ) : (
                <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
                  <ScrollArea>
                    <Table verticalSpacing="md" miw={920} highlightOnHover>
                      <Table.Thead bg="gray.0">
                        <Table.Tr>
                          <Table.Th>Request</Table.Th>
                          <Table.Th>Type</Table.Th>
                          <Table.Th ta="center">Sent</Table.Th>
                          <Table.Th ta="center">Not opened</Table.Th>
                          <Table.Th ta="center">Ignored</Table.Th>
                          <Table.Th ta="center">Completed</Table.Th>
                          <Table.Th>Created</Table.Th>
                          <Table.Th ta="right">Actions</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {data.popupRequests.map((request) => (
                          <Table.Tr key={request.id}>
                            <Table.Td>
                              <Stack gap={4}>
                                <Group gap="xs" wrap="nowrap">
                                  <Text fw={800}>{request.title}</Text>
                                  <Badge variant="light" color={request.status ? "green" : "gray"}>
                                    {request.status ? "Active" : "Inactive"}
                                  </Badge>
                                  {request.requiresSignature ? (
                                    <Badge color="grape" variant="light">
                                      Signature
                                    </Badge>
                                  ) : null}
                                </Group>
                                {request.body ? (
                                  <Text size="sm" c="dimmed" lineClamp={1}>
                                    {request.body}
                                  </Text>
                                ) : null}
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="light">{formatPopupRequestType(request.type)}</Badge>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text fw={800}>{request.sentCount}</Text>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text fw={800} c={request.notOpenedCount > 0 ? "orange" : undefined}>
                                {request.notOpenedCount}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text fw={800} c={request.promptedCount > 0 ? "orange" : undefined}>
                                {request.promptedCount}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Text fw={800} c={request.completedCount > 0 ? "green" : undefined}>
                                {request.completedCount}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{formatDateTime(request.createdAt)}</Text>
                            </Table.Td>
                            <Table.Td ta="right">
                              <Button variant="light" size="xs" onClick={() => setPopupDetail(request)}>
                                Details
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Paper>
              )
            )}
          </Stack>

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
        opened={Boolean(popupDetail)}
        onClose={() => setPopupDetail(null)}
        title={isMobile ? "Popup request details" : popupDetail ? `Popup request: ${popupDetail.title}` : "Popup request"}
        size={isMobile ? "100%" : "95%"}
        fullScreen={isMobile}
        centered={!isMobile}
        padding={isMobile ? "md" : "lg"}
      >
        {popupDetail ? (
          <Stack gap="md">
            {isMobile ? (
              <Stack gap="xs" align="center" ta="center">
                <Group gap="xs" justify="center">
                  <Badge color={popupDetail.status ? "green" : "gray"} variant="light" size="lg">
                    {popupDetail.status ? "Active" : "Inactive"}
                  </Badge>
                  <Badge variant="light" size="lg">
                    {formatPopupRequestType(popupDetail.type)}
                  </Badge>
                  {popupDetail.requiresSignature ? (
                    <Badge color="grape" variant="light" size="lg">
                      Signature
                    </Badge>
                  ) : null}
                </Group>
                <Title order={3}>{popupDetail.title}</Title>
                {popupDetail.body ? (
                  <Text c="dimmed" size="sm">
                    {popupDetail.body}
                  </Text>
                ) : null}
              </Stack>
            ) : null}
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
              <RequestMetric label="Sent" value={popupDetail.sentCount} tone="blue" />
              <RequestMetric label="Not opened" value={popupDetail.notOpenedCount} tone="orange" />
              <RequestMetric label="Ignored" value={popupDetail.promptedCount} tone="orange" />
              <RequestMetric label="Completed" value={popupDetail.completedCount} tone="green" />
            </SimpleGrid>
            {isMobile ? (
              <Stack gap="sm">
                {popupDetail.recipients.map((recipient) => (
                  <PopupRecipientMobileCard key={`${popupDetail.id}-${recipient.userId}`} recipient={recipient} />
                ))}
              </Stack>
            ) : (
              <ScrollArea>
                <Table striped highlightOnHover verticalSpacing="md" miw={980}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>User</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Prompted</Table.Th>
                      <Table.Th>Last prompted</Table.Th>
                      <Table.Th>Prompt count</Table.Th>
                      <Table.Th>Completed</Table.Th>
                      <Table.Th>Selected / response</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {popupDetail.recipients.map((recipient) => (
                      <Table.Tr key={`${popupDetail.id}-${recipient.userId}`}>
                        <Table.Td>
                          <Stack gap={0}>
                            <Text fw={700}>{recipient.name}</Text>
                            {recipient.email ? (
                              <Text size="xs" c="dimmed">
                                {recipient.email}
                              </Text>
                            ) : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={getPopupRecipientStatusColor(recipient.status)} variant="light">
                            {getPopupRecipientStatusLabel(recipient.status)}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{formatOptionalDateTime(recipient.promptedAt)}</Table.Td>
                        <Table.Td>{formatOptionalDateTime(recipient.lastPromptedAt)}</Table.Td>
                        <Table.Td>{recipient.promptCount}</Table.Td>
                        <Table.Td>{formatOptionalDateTime(recipient.completedAt)}</Table.Td>
                        <Table.Td>
                          {recipient.response && Object.keys(recipient.response).length > 0 ? (
                            <Stack gap="xs">
                              {getSignatureDataUrl(recipient.response) ? (
                                <img
                                  src={getSignatureDataUrl(recipient.response) ?? undefined}
                                  alt={`${recipient.name} signature`}
                                  style={{
                                    width: 180,
                                    maxWidth: "100%",
                                    height: 56,
                                    objectFit: "contain",
                                    border: "1px solid #d7e0ea",
                                    borderRadius: 8,
                                    background: "#ffffff",
                                  }}
                                />
                              ) : null}
                              <Text
                                component="pre"
                                size="xs"
                                style={{
                                  margin: 0,
                                  whiteSpace: "pre-wrap",
                                  maxWidth: 360,
                                  fontFamily: "Fira Code, monospace",
                                }}
                              >
                                {stringifyPopupResponse(recipient.response)}
                              </Text>
                            </Stack>
                          ) : (
                            <Text size="sm" c="dimmed">
                              -
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Stack>
        ) : null}
      </Modal>

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

      <Modal
        opened={requiredActionModalOpen}
        onClose={() => setRequiredActionModalOpen(false)}
        title="New popup request"
        size={isMobile ? "100%" : "lg"}
        fullScreen={isMobile}
        centered={!isMobile}
        padding={isMobile ? "md" : "lg"}
      >
        <Stack gap="md">
          {isMobile ? (
            <Stack gap={4} align="center" ta="center">
              <Title order={3}>Create popup request</Title>
              <Text size="sm" c="dimmed">
                This will appear as a blocking full-screen task for the selected audience.
              </Text>
            </Stack>
          ) : null}
          <Card withBorder radius="lg" p={isMobile ? "md" : "lg"}>
            <Stack gap="md">
              <Stack gap={2} align="center" ta="center">
                <Title order={5}>Request</Title>
                <Text size="sm" c="dimmed">
                  Write the action users will see when they open the app.
                </Text>
              </Stack>
              <Select
                label="Request type"
                data={REQUIRED_ACTION_TYPE_OPTIONS}
                value={requiredActionType}
                onChange={(value) => setRequiredActionType((value as CreateRequiredActionPayload["type"] | null) ?? "broadcast")}
                allowDeselect={false}
              />
              <TextInput
                label="Title"
                placeholder="What users need to do"
                value={requiredActionTitle}
                onChange={(event) => setRequiredActionTitle(event.currentTarget.value)}
                required
              />
              <Textarea
                label="Message"
                placeholder="Add the instruction users will see in the full-screen popup"
                value={requiredActionBody}
                onChange={(event) => setRequiredActionBody(event.currentTarget.value)}
                autosize
                minRows={4}
              />
              <Switch
                label="Require e-signature"
                description="Users must draw a signature before they can complete this popup request."
                checked={requiredActionRequiresSignature}
                onChange={(event) => setRequiredActionRequiresSignature(event.currentTarget.checked)}
              />
            </Stack>
          </Card>
          <Card withBorder radius="lg" p={isMobile ? "md" : "lg"}>
            <Stack gap="md">
              <Stack gap={2} align="center" ta="center">
                <Title order={5}>Audience</Title>
                <Text size="sm" c="dimmed">
                  Leave every target empty to send this popup to all active users. If you select multiple target groups,
                  users must match every selected group.
                </Text>
              </Stack>
              {targetOptionsQuery.isError ? (
                <Alert color="red">
                  {targetOptionsQuery.error instanceof Error
                    ? targetOptionsQuery.error.message
                    : "Unable to load targeting options"}
                </Alert>
              ) : null}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <MultiSelect
                  label="Specific users"
                  placeholder={targetOptionsQuery.isLoading ? "Loading users..." : "Choose users"}
                  data={targetUserOptions}
                  value={targetUserIds}
                  onChange={setTargetUserIds}
                  searchable
                  clearable
                  disabled={targetOptionsQuery.isLoading}
                />
                <MultiSelect
                  label="User types"
                  placeholder={targetOptionsQuery.isLoading ? "Loading user types..." : "Choose user types"}
                  data={targetUserTypeOptions}
                  value={targetUserTypeIds}
                  onChange={setTargetUserTypeIds}
                  searchable
                  clearable
                  disabled={targetOptionsQuery.isLoading}
                />
                <MultiSelect
                  label="Staff profile"
                  placeholder="Choose staff profile types"
                  data={STAFF_PROFILE_TYPE_OPTIONS}
                  value={targetStaffProfileTypes}
                  onChange={setTargetStaffProfileTypes}
                  searchable
                  clearable
                />
                <MultiSelect
                  label="Shift roles"
                  placeholder={targetOptionsQuery.isLoading ? "Loading shift roles..." : "Choose shift roles"}
                  data={targetShiftRoleOptions}
                  value={targetShiftRoleIds}
                  onChange={setTargetShiftRoleIds}
                  searchable
                  clearable
                  disabled={targetOptionsQuery.isLoading}
                />
              </SimpleGrid>
            </Stack>
          </Card>
          {requiredActionType === "profile_fields" ? (
            <Card withBorder radius="lg" p={isMobile ? "md" : "lg"}>
              <MultiSelect
                label="Required user fields"
                placeholder="Choose fields"
                data={REQUIRED_PROFILE_FIELD_OPTIONS}
                value={requiredActionFields}
                onChange={setRequiredActionFields}
                searchable
                required
              />
            </Card>
          ) : null}
          {requiredActionType === "policy_consent" ? (
            <Card withBorder radius="lg" p={isMobile ? "md" : "lg"}>
              <Select
                label="Cerebro policy"
                placeholder={cerebroQuery.isLoading ? "Loading policies..." : "Choose a policy"}
                data={cerebroPolicyOptions}
                value={requiredActionPolicyId}
                onChange={setRequiredActionPolicyId}
                searchable
                required
              />
            </Card>
          ) : null}
          {requiredActionType === "quiz" ? (
            <Card withBorder radius="lg" p={isMobile ? "md" : "lg"}>
              <Select
                label="Cerebro quiz"
                placeholder={cerebroQuery.isLoading ? "Loading quizzes..." : "Choose a quiz"}
                data={cerebroQuizOptions}
                value={requiredActionQuizId}
                onChange={setRequiredActionQuizId}
                searchable
                required
              />
            </Card>
          ) : null}
          <Alert color="blue" variant="light">
            This creates a blocking full-screen popup for every active user who matches the selected targets.
          </Alert>
          <Group justify="space-between" grow={isMobile}>
            <Button
              variant="default"
              onClick={() => setRequiredActionModalOpen(false)}
              disabled={createRequiredAction.isPending}
              fullWidth={isMobile}
            >
              Cancel
            </Button>
            <Button loading={createRequiredAction.isPending} onClick={handleCreateRequiredAction} fullWidth={isMobile}>
              Create popup
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );

  return <PageAccessGuard pageSlug={PAGE_SLUG}>{content}</PageAccessGuard>;
};

export default RequestsPage;
