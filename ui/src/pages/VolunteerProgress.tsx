import { useEffect, useId, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  Progress,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendarCheck,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClockCheck,
  IconInfoCircle,
  IconLock,
  IconMessageStar,
  IconRefresh,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconUserCheck,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import {
  getVolunteerMilestoneErrorMessage,
  useMyVolunteerMilestones,
  useUpdateVolunteerAttendance,
  useUpdateVolunteerFeedback,
  useUpdateVolunteerStayFeedback,
  useVolunteerMilestoneDetail,
  useVolunteerMilestoneList,
  type VolunteerAttendanceAssignment,
  type VolunteerAttendanceStatus,
  type VolunteerMilestone,
  type VolunteerMilestoneDetail,
  type VolunteerProgressReport,
} from "../api/volunteerMilestones";
import VolunteerStayProgress from "../components/volunteer/VolunteerStayProgress";
import { useAppSelector } from "../store/hooks";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import {
  canManageVolunteerProgress,
  clampProgressPercent,
  formatMilestoneAmount,
  formatVolunteerProgressNumber,
  formatVolunteerProgressTimestamp,
  formatVolunteerProgressMonth,
  getCurrentMonth,
  moveVolunteerProgressMonth,
  orderVolunteerMilestones,
  getVolunteerReportContext,
} from "../utils/volunteerMilestones";

const MILESTONE_ICONS: Record<VolunteerMilestone["key"], typeof IconStar> = {
  reviews: IconMessageStar,
  attendance: IconClockCheck,
  monthly_shifts: IconCalendarCheck,
  cleaning: IconSparkles,
  management_feedback: IconUserCheck,
};

const ATTENDANCE_OPTIONS: Array<{
  value: VolunteerAttendanceStatus;
  label: string;
}> = [
  { value: "attended", label: "Attended on time" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "excused", label: "Excused absence" },
];

const attendanceStatusMeta = (status: VolunteerAttendanceStatus | null) => {
  switch (status) {
    case "attended":
      return { label: "Attended", color: "teal" };
    case "late":
      return { label: "Late", color: "yellow" };
    case "absent":
      return { label: "Absent", color: "red" };
    case "excused":
      return { label: "Excused", color: "gray" };
    default:
      return { label: "Awaiting confirmation", color: "blue" };
  }
};

const evidenceStatusMeta = (status: string | null | undefined) => {
  const normalized = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["absent", "missed", "failed", "rejected", "declined"].includes(normalized)) {
    return { color: "red", Icon: IconAlertCircle, label: "Negative evidence" };
  }
  if (normalized === "late") {
    return { color: "yellow", Icon: IconClockCheck, label: "Late attendance" };
  }
  if (normalized === "excused") {
    return { color: "gray", Icon: IconInfoCircle, label: "Excused attendance" };
  }
  if (["pending", "awaiting", "unconfirmed", "draft"].includes(normalized)) {
    return { color: "blue", Icon: IconClockCheck, label: "Pending evidence" };
  }
  return { color: "teal", Icon: IconCheck, label: "Positive evidence" };
};

const formatShiftTime = (startTime: string, endTime: string | null) => {
  const start = startTime.slice(0, 5);
  const end = endTime?.slice(0, 5);
  return end ? `${start}–${end}` : start;
};

const getInitials = (firstName: string, lastName: string) =>
  `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "V";

const MilestoneStatusIcon = ({ milestone }: { milestone: VolunteerMilestone }) => {
  const Icon = milestone.earned ? IconStarFilled : milestone.state === "locked" ? IconLock : IconStar;
  const label = milestone.earned
    ? `${milestone.title} star earned`
    : milestone.state === "locked"
      ? `${milestone.title} star locked`
      : `${milestone.title} star in progress`;

  return (
    <Tooltip label={label} withArrow>
      <ThemeIcon
        role="img"
        aria-label={label}
        size={52}
        radius="xl"
        variant={milestone.earned ? "filled" : "light"}
        color={milestone.earned ? "yellow" : milestone.state === "locked" ? "gray" : "blue"}
        styles={{ root: { flexShrink: 0 } }}
      >
        <Icon size={28} aria-hidden="true" />
      </ThemeIcon>
    </Tooltip>
  );
};

const MilestoneCard = ({
  milestone,
  index,
  periodTimezone,
}: {
  milestone: VolunteerMilestone;
  index: number;
  periodTimezone: string;
}) => {
  const Icon = MILESTONE_ICONS[milestone.key];
  const evidenceListId = useId();
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const progress = clampProgressPercent(milestone.progressPercent);
  const status = milestone.earned
    ? { label: "Earned", color: "teal" }
    : milestone.state === "locked"
      ? { label: "Locked", color: "gray" }
      : { label: "In progress", color: "blue" };

  return (
    <Card
      withBorder
      radius="xl"
      padding="lg"
      shadow={milestone.earned ? "sm" : undefined}
      style={{
        borderTop: `4px solid ${milestone.earned ? "#fab005" : milestone.state === "locked" ? "#ced4da" : "#228be6"}`,
        height: "100%",
      }}
    >
      <Stack gap="md" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <MilestoneStatusIcon milestone={milestone} />
            <Box>
              <Group gap={5} wrap="nowrap">
                <Icon size={14} color="#868e96" aria-hidden="true" />
                <Text size="xs" fw={800} c="dimmed" tt="uppercase" lts={0.7}>
                  Star {index + 1}
                </Text>
              </Group>
              <Title order={3} size="h4" lh={1.25}>
                {milestone.title}
              </Title>
            </Box>
          </Group>
          <Badge color={status.color} variant="light" radius="sm">
            {status.label}
          </Badge>
        </Group>

        <Box>
          <Group justify="space-between" mb={6} align="end">
            <Text size="sm" fw={700}>
              {formatMilestoneAmount(milestone)}
            </Text>
            <Text size="xs" fw={800} c={milestone.earned ? "teal.7" : "dimmed"}>
              {Math.round(progress)}%
            </Text>
          </Group>
          <Progress
            value={progress}
            color={milestone.earned ? "teal" : milestone.state === "locked" ? "gray" : "blue"}
            radius="xl"
            size="md"
            aria-label={`${milestone.title}: ${Math.round(progress)} percent complete`}
          />
          <Text size="sm" mt="xs" c={milestone.earned ? "teal.8" : "dark.6"} fw={600}>
            {milestone.remainingText}
          </Text>
          {milestone.expectedToDate !== undefined && ["reviews", "monthly_shifts", "cleaning"].includes(milestone.key) ? (
            <Text size="xs" c="dimmed" mt={4}>
              Expected to date: {formatVolunteerProgressNumber(milestone.expectedToDate)}{milestone.unit === "%" ? "%" : ` ${milestone.unit}`}
            </Text>
          ) : null}
          {milestone.subtargets?.length ? (
            <Stack gap="xs" mt="sm">
              {milestone.subtargets.map((target) => (
                <Paper key={target.key} withBorder radius="md" p="xs">
                  <Text size="sm" fw={700}>{target.title}</Text>
                  <Text size="sm">{target.unit === '%' ? `${formatVolunteerProgressNumber(target.current)}% · target ${formatVolunteerProgressNumber(target.target)}%`
                    : `${formatVolunteerProgressNumber(target.current)} of ${formatVolunteerProgressNumber(target.target)} ${target.unit} for the stay`}</Text>
                  {target.unit !== '%' && <Text size="xs" c="dimmed">Expected to date: {formatVolunteerProgressNumber(target.expectedToDate)}</Text>}
                </Paper>
              ))}
            </Stack>
          ) : null}
        </Box>

        <Paper radius="md" p="sm" bg="gray.0" withBorder>
          <Group gap={6} mb={4} wrap="nowrap">
            <IconInfoCircle size={16} color="#495057" aria-hidden="true" />
            <Text size="xs" fw={800} tt="uppercase" c="dimmed" lts={0.5}>
              Why this status
            </Text>
          </Group>
          <Text size="sm" c="dark.7" lh={1.45}>
            {milestone.reason}
          </Text>
        </Paper>

        <Box mt="auto">
          <Text size="xs" fw={800} tt="uppercase" c="dimmed" lts={0.5} mb="xs">
            Evidence
          </Text>
          {milestone.evidence.length > 0 ? (
            <Stack gap={6}>
              <Stack gap={6} id={evidenceListId}>
                {(showAllEvidence ? milestone.evidence : milestone.evidence.slice(0, 3)).map(
                  (item, evidenceIndex) => {
                    const evidenceMeta = evidenceStatusMeta(item.status);
                    const EvidenceIcon = evidenceMeta.Icon;
                    return (
                      <Group
                        key={`${milestone.key}-${String(item.id ?? evidenceIndex)}`}
                        gap="xs"
                        wrap="nowrap"
                        align="flex-start"
                      >
                        <Tooltip label={evidenceMeta.label} withArrow>
                          <ThemeIcon
                            role="img"
                            aria-label={evidenceMeta.label}
                            size={22}
                            radius="xl"
                            color={evidenceMeta.color}
                            variant="light"
                            mt={1}
                            style={{ flexShrink: 0 }}
                          >
                            <EvidenceIcon size={13} aria-hidden="true" />
                          </ThemeIcon>
                        </Tooltip>
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={650} lh={1.3}>
                            {item.label}
                          </Text>
                          {(item.detail || item.occurredAt || item.status) && (
                            <Text size="xs" c="dimmed" lh={1.35}>
                              {[
                                item.detail,
                                item.status,
                                item.occurredAt
                                  ? formatVolunteerProgressTimestamp(
                                      item.occurredAt,
                                      periodTimezone,
                                      "D MMM",
                                    )
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          )}
                        </Box>
                      </Group>
                    );
                  },
                )}
              </Stack>
              {milestone.evidence.length > 3 && (
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-xs"
                  px={6}
                  ml={24}
                  onClick={() => setShowAllEvidence((current) => !current)}
                  aria-expanded={showAllEvidence}
                  aria-controls={evidenceListId}
                >
                  {showAllEvidence
                    ? "Show less evidence"
                    : `Show all ${milestone.evidence.length} evidence items`}
                </Button>
              )}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              No evidence has been recorded for this milestone yet.
            </Text>
          )}
        </Box>
      </Stack>
    </Card>
  );
};

const ProgressHero = ({ detail }: { detail: VolunteerProgressReport }) => {
  const orderedMilestones = orderVolunteerMilestones(detail.milestones);
  const context = getVolunteerReportContext(detail);
  const fullName = `${detail.user.firstName} ${detail.user.lastName}`.trim() || detail.user.email;
  const allEarned = detail.starsEarned === detail.totalStars;

  return (
    <Paper
      radius="xl"
      p={{ base: "lg", sm: "xl" }}
      c="white"
      style={{
        overflow: "hidden",
        background: "linear-gradient(135deg, #111827 0%, #1c3d63 56%, #136f63 100%)",
        boxShadow: "0 18px 44px rgba(17, 24, 39, 0.16)",
      }}
    >
      <Group justify="space-between" align="center" gap="xl">
        <Group gap="lg" wrap="nowrap">
          <Avatar
            src={detail.user.profilePhotoUrl ?? undefined}
            size={72}
            radius="xl"
            color="teal"
            style={{ border: "3px solid rgba(255, 255, 255, 0.4)", flexShrink: 0 }}
          >
            {getInitials(detail.user.firstName, detail.user.lastName)}
          </Avatar>
          <Box>
            <Text size="sm" c="rgba(255,255,255,0.72)" fw={700} tt="uppercase" lts={0.8}>
              Volunteer milestone path
            </Text>
            <Title order={2} size="h2" c="white" mt={2}>
              {fullName}
            </Title>
            <Text c="rgba(255,255,255,0.78)" mt={4}>
              {allEarned
                ? `All five stars are earned for ${context.periodLabel}.`
                : `${detail.totalStars - detail.starsEarned} star${detail.totalStars - detail.starsEarned === 1 ? "" : "s"} left to complete ${context.periodLabel}.`}
            </Text>
          </Box>
        </Group>

        <Stack gap="xs" align="center">
          <Group gap={8} role="list" aria-label={`${detail.starsEarned} of ${detail.totalStars} stars earned`}>
            {orderedMilestones.map((milestone, index) => {
              const label = `Star ${index + 1}, ${milestone.title}: ${milestone.earned ? "earned" : milestone.state === "locked" ? "locked" : "in progress"}`;
              return (
                <Tooltip label={label} key={milestone.key} withArrow>
                  <Box role="listitem">
                    <ThemeIcon
                      role="img"
                      aria-label={label}
                      size={42}
                      radius="xl"
                      variant={milestone.earned ? "filled" : "outline"}
                      color={milestone.earned ? "yellow" : "gray"}
                      style={{
                        color: milestone.earned ? "#5f3c00" : "rgba(255,255,255,0.7)",
                        borderColor: "rgba(255,255,255,0.35)",
                        background: milestone.earned ? undefined : "rgba(255,255,255,0.08)",
                      }}
                    >
                      {milestone.earned ? (
                        <IconStarFilled size={23} aria-hidden="true" />
                      ) : milestone.state === "locked" ? (
                        <IconLock size={20} aria-hidden="true" />
                      ) : (
                        <IconStar size={23} aria-hidden="true" />
                      )}
                    </ThemeIcon>
                  </Box>
                </Tooltip>
              );
            })}
          </Group>
          <Text fw={800} size="lg">
            {detail.starsEarned} / {detail.totalStars} stars earned
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
};

const VolunteerFeedbackSummary = ({ detail }: { detail: VolunteerProgressReport }) => {
  const context = getVolunteerReportContext(detail);
  const feedback = detail.managementFeedback;
  const isApproved = feedback?.approved ?? false;
  const finalMilestone = detail.milestones.find(
    (milestone) => milestone.key === "management_feedback",
  );
  const approvalIsCurrent = isApproved && Boolean(finalMilestone?.earned);
  const approvalIsOnHold = isApproved && !approvalIsCurrent;

  return (
    <Paper withBorder radius="xl" p={{ base: "md", sm: "lg" }}>
      <Group justify="space-between" align="flex-start" gap="md" mb="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon
            color={approvalIsCurrent ? "teal" : approvalIsOnHold ? "yellow" : "blue"}
            variant="light"
            radius="xl"
            size="lg"
          >
            <IconUserCheck size={20} aria-hidden="true" />
          </ThemeIcon>
          <Box>
            <Text fw={800}>Management feedback</Text>
            <Text size="sm" c="dimmed">
              The final, human-reviewed part of the five-star path.
            </Text>
          </Box>
        </Group>
        <Badge color={approvalIsCurrent ? "teal" : approvalIsOnHold ? "yellow" : "blue"} variant="light">
          {approvalIsCurrent
            ? "Approved"
            : approvalIsOnHold
              ? "Approval on hold"
              : feedback
                ? "Draft"
                : "Awaiting feedback"}
        </Badge>
      </Group>

      {feedback?.feedback ? (
        <Paper bg="gray.0" radius="md" p="md" withBorder>
          <Text size="sm" lh={1.55} style={{ whiteSpace: "pre-wrap" }}>
            {feedback.feedback}
          </Text>
        </Paper>
      ) : (
        <Text size="sm" c="dimmed">
          Management has not added written feedback for {context.periodLabel} yet.
        </Text>
      )}

      {isApproved && feedback?.approvedAt ? (
        <Stack gap={4} mt="sm">
          <Text size="sm" c={approvalIsCurrent ? "teal.7" : "yellow.8"} fw={650}>
            {approvalIsCurrent ? "Approved" : "Approval recorded"} {formatVolunteerProgressTimestamp(
              feedback.approvedAt,
              context.timezone,
              "D MMM YYYY, HH:mm",
            )}
            {feedback.approvedByName ? ` by ${feedback.approvedByName}` : ""}
          </Text>
          {approvalIsOnHold && (
            <Text size="sm" c="yellow.9">
              The final star is on hold because one or more measurable milestones no longer meet their requirements.
            </Text>
          )}
        </Stack>
      ) : feedback?.updatedAt ? (
        <Text size="xs" c="dimmed" mt="sm">
          Draft updated {formatVolunteerProgressTimestamp(
            feedback.updatedAt,
            context.timezone,
            "D MMM YYYY, HH:mm",
          )}
          {feedback.updatedByName ? ` by ${feedback.updatedByName}` : ""}
        </Text>
      ) : null}
    </Paper>
  );
};

const AttendanceEditor = ({
  assignment,
  periodTimezone,
  stayId,
}: {
  assignment: VolunteerAttendanceAssignment;
  periodTimezone: string;
  stayId?: number;
}) => {
  const updateAttendance = useUpdateVolunteerAttendance();
  const [status, setStatus] = useState<VolunteerAttendanceStatus | null>(assignment.status);
  const [notes, setNotes] = useState(assignment.notes ?? "");
  const [saved, setSaved] = useState(false);
  const statusMeta = attendanceStatusMeta(assignment.status);

  useEffect(() => {
    setStatus(assignment.status);
    setNotes(assignment.notes ?? "");
    setSaved(false);
  }, [assignment.assignmentId, assignment.notes, assignment.status]);

  const dirty = status !== assignment.status || notes.trim() !== (assignment.notes ?? "").trim();

  const handleSave = async () => {
    if (!status) {
      return;
    }
    setSaved(false);
    try {
      await updateAttendance.mutateAsync({ assignmentId: assignment.assignmentId, status, notes, ...(stayId ? { stayId } : {}) });
      setSaved(true);
    } catch {
      // The mutation exposes a contextual inline error below.
    }
  };

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" gap="sm">
          <Box>
            <Group gap="xs">
              <Text fw={750}>{assignment.shiftName}</Text>
              <Badge color={statusMeta.color} variant="light" size="sm">
                {statusMeta.label}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={3}>
              {dayjs(assignment.date).format("ddd, D MMM")} · {formatShiftTime(assignment.startTime, assignment.endTime)}
              {assignment.role ? ` · ${assignment.role}` : ""}
            </Text>
          </Box>
          {assignment.recordedAt && (
            <Text size="xs" c="dimmed">
              Updated {formatVolunteerProgressTimestamp(assignment.recordedAt, periodTimezone)}
              {assignment.recordedByName ? ` by ${assignment.recordedByName}` : ""}
            </Text>
          )}
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <Select
            label="Attendance result"
            placeholder="Choose a result"
            data={ATTENDANCE_OPTIONS}
            value={status}
            onChange={(value) => {
              setStatus(value as VolunteerAttendanceStatus | null);
              setSaved(false);
            }}
            allowDeselect={false}
            aria-label={`Attendance result for ${assignment.shiftName} on ${assignment.date}`}
          />
          <Textarea
            label="Manager note"
            placeholder="Optional context the volunteer can understand"
            value={notes}
            onChange={(event) => {
              setNotes(event.currentTarget.value);
              setSaved(false);
            }}
            autosize
            minRows={1}
            maxRows={4}
            maxLength={2000}
          />
        </SimpleGrid>

        <Group justify="flex-end">
          {saved && (
            <Text size="sm" c="teal.7" fw={650}>
              Saved and progress recalculated.
            </Text>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!status || !dirty}
            loading={updateAttendance.isPending}
          >
            Save attendance
          </Button>
        </Group>
        {updateAttendance.isError && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} p="sm">
            {getVolunteerMilestoneErrorMessage(
              updateAttendance.error,
              "Attendance could not be saved. Please try again.",
            )}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
};

const ManagementWorkspace = ({ detail }: { detail: VolunteerProgressReport }) => {
  const saveFeedback = useUpdateVolunteerFeedback();
  const saveStayFeedback = useUpdateVolunteerStayFeedback();
  const context = getVolunteerReportContext(detail);
  const selectedFeedbackMutation = context.stay ? saveStayFeedback : saveFeedback;
  const [feedbackRevision, setFeedbackRevision] = useState(context.stay?.revision ?? 0);
  const [feedbackScope, setFeedbackScope] = useState(`${detail.user.id}:${context.key}`);
  const [approved, setApproved] = useState(detail.managementFeedback?.approved ?? false);
  const [feedback, setFeedback] = useState(detail.managementFeedback?.feedback ?? "");
  const [saved, setSaved] = useState(false);
  const pastAssignments = useMemo(
    () =>
      detail.attendanceAssignments
        .filter((assignment) => assignment.isPast)
        .sort((left, right) => `${right.date} ${right.startTime}`.localeCompare(`${left.date} ${left.startTime}`)),
    [detail.attendanceAssignments],
  );
  const measurableStarsEarned = detail.milestones.filter(
    (milestone) => milestone.key !== "management_feedback" && milestone.earned,
  ).length;
  const feedbackDirty =
    approved !== (detail.managementFeedback?.approved ?? false) ||
    feedback.trim() !== (detail.managementFeedback?.feedback ?? "").trim();
  const approvalBlocked = approved && measurableStarsEarned < 4;
  const storedApprovalIsOnHold =
    Boolean(detail.managementFeedback?.approved) && measurableStarsEarned < 4;

  useEffect(() => {
    const nextScope = `${detail.user.id}:${context.key}`;
    if (feedbackScope === nextScope && feedbackDirty) return;
    setApproved(detail.managementFeedback?.approved ?? false);
    setFeedback(detail.managementFeedback?.feedback ?? "");
    setFeedbackRevision(context.stay?.revision ?? 0);
    setFeedbackScope(nextScope);
    setSaved(false);
  }, [detail.managementFeedback, detail.user.id, context.key, context.stay?.revision, feedbackScope, feedbackDirty]);

  const handleFeedbackSave = async () => {
    setSaved(false);
    try {
      if (context.stay) {
        await saveStayFeedback.mutateAsync({
          userId: detail.user.id,
          stayId: context.stay.id,
          expectedRevision: feedbackRevision,
          approved,
          feedback,
        });
      } else {
        await saveFeedback.mutateAsync({
          userId: detail.user.id,
          period: (detail as VolunteerMilestoneDetail).period.month,
          approved,
          feedback,
        });
      }
      setSaved(true);
    } catch {
      // The mutation exposes a contextual inline error below.
    }
  };

  return (
    <Paper withBorder radius="xl" p={{ base: "md", sm: "xl" }} shadow="xs">
      <Stack gap="xl">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs">
              <ThemeIcon color="orange" variant="light" radius="xl" size="lg">
                <IconUserCheck size={20} aria-hidden="true" />
              </ThemeIcon>
              <Title order={2} size="h3">
                Manager workspace
              </Title>
              <Badge color="orange" variant="light">
                Management only
              </Badge>
            </Group>
            <Text c="dimmed" mt="xs" maw={760}>
              Confirm completed shifts and leave clear final feedback. Changes are visible to the volunteer and immediately recalculate their milestone progress.
            </Text>
          </Box>
        </Group>

        <Box>
          <Title order={3} size="h4" mb={4}>
            Past shift attendance
          </Title>
          <Text size="sm" c="dimmed" mb="md">
            {context.stay
              ? "Attendance is attended shifts divided by non-excused shifts; punctuality is on-time arrivals divided by attended shifts. Both must meet the saved threshold, and pending confirmations block the star. An absence lowers attendance instead of automatically vetoing the result."
              : "On-time attendance counts toward the attendance star. Late, absent, and excused shifts stay visible as transparent evidence."}
          </Text>
          {pastAssignments.length > 0 ? (
            <Stack gap="sm">
              {pastAssignments.map((assignment) => (
                <AttendanceEditor
                  key={assignment.assignmentId}
                  assignment={assignment}
                  periodTimezone={context.timezone}
                  stayId={context.stay?.id}
                />
              ))}
            </Stack>
          ) : (
            <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
              There are no past shift assignments to confirm for this volunteer in {context.label}.
            </Alert>
          )}
        </Box>

        <Divider />

        <Box>
          <Group justify="space-between" align="flex-start" mb="md">
            <Box>
              <Title order={3} size="h4">
                Final management feedback
              </Title>
              <Text size="sm" c="dimmed" mt={4}>
                This is the fifth star and the final quality confirmation for {context.periodLabel}.
              </Text>
            </Box>
            <Badge color={measurableStarsEarned === 4 ? "teal" : "yellow"} variant="light" size="lg">
              {measurableStarsEarned} of 4 measurable stars earned
            </Badge>
          </Group>

          {measurableStarsEarned < 4 && (
            <Alert color="yellow" icon={<IconAlertCircle size={18} />} mb="md">
              {storedApprovalIsOnHold
                ? "The saved approval is on hold because one or more measurable milestones no longer meet their requirements. Remove the approval or restore all four milestones."
                : "Final approval becomes available after the first four measurable stars are earned. You can still draft feedback now."}
            </Alert>
          )}

          <Stack gap="md">
            <Switch
              checked={approved}
              onChange={(event) => {
                setApproved(event.currentTarget.checked);
                setSaved(false);
              }}
              size="md"
              color="teal"
              disabled={measurableStarsEarned < 4 && !(detail.managementFeedback?.approved ?? false)}
              label={
                approved && storedApprovalIsOnHold
                  ? "Approval saved; final star on hold"
                  : approved
                    ? "Final star approved"
                    : "Final star not approved"
              }
              description="The volunteer will see this decision and the feedback below."
            />
            <Textarea
              label="Feedback for the volunteer"
              description="Be specific, constructive, and explain what supported the decision."
              placeholder="Share what went well and what to focus on next."
              value={feedback}
              onChange={(event) => {
                setFeedback(event.currentTarget.value);
                setSaved(false);
              }}
              autosize
              minRows={4}
              maxRows={10}
              maxLength={5000}
            />
            {detail.managementFeedback?.approved && detail.managementFeedback.approvedAt && (
              <Text size="sm" c="teal.7" fw={650}>
                Approved {formatVolunteerProgressTimestamp(
                  detail.managementFeedback.approvedAt,
                  context.timezone,
                  "D MMM YYYY, HH:mm",
                )}
                {detail.managementFeedback.approvedByName
                  ? ` by ${detail.managementFeedback.approvedByName}`
                  : ""}
              </Text>
            )}
            {detail.managementFeedback?.updatedAt && (
              <Text size="xs" c="dimmed">
                Last updated {formatVolunteerProgressTimestamp(
                  detail.managementFeedback.updatedAt,
                  context.timezone,
                  "D MMM YYYY, HH:mm",
                )}
                {detail.managementFeedback.updatedByName
                  ? ` by ${detail.managementFeedback.updatedByName}`
                  : ""}
              </Text>
            )}
            <Group justify="flex-end">
              {saved && (
                <Text size="sm" c="teal.7" fw={650}>
                  Feedback saved.
                </Text>
              )}
              <Button
                color="teal"
                onClick={handleFeedbackSave}
                disabled={!feedbackDirty || approvalBlocked}
                loading={selectedFeedbackMutation.isPending}
              >
                Save final feedback
              </Button>
            </Group>
            {selectedFeedbackMutation.isError && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {getVolunteerMilestoneErrorMessage(
                  selectedFeedbackMutation.error,
                  "Management feedback could not be saved. Please try again.",
                )}
              </Alert>
            )}
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
};

export const LegacyVolunteerProgress = () => {
  const roleSlug = useAppSelector((state) => state.session.roleSlug);
  const staffType = useAppSelector((state) => state.session.staffType);
  const isManagementRole = canManageVolunteerProgress(roleSlug);
  const milestoneAccess = useModuleAccess(PAGE_SLUGS.volunteerProgress);
  const canViewMilestones = milestoneAccess.ready && milestoneAccess.canView;
  const isActiveVolunteer = staffType === "volunteer";
  const canLoadMilestones = canViewMilestones && (isManagementRole || isActiveVolunteer);
  const canEdit = isManagementRole && canViewMilestones && milestoneAccess.canUpdate;
  const [period, setPeriod] = useState(getCurrentMonth);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const listQuery = useVolunteerMilestoneList(period, isManagementRole && canLoadMilestones);
  const myProgressQuery = useMyVolunteerMilestones(period, !isManagementRole && canLoadMilestones);
  const selectedProgressQuery = useVolunteerMilestoneDetail(
    selectedUserId,
    period,
    isManagementRole && canLoadMilestones,
  );
  const currentMonth = getCurrentMonth();

  const volunteers = useMemo(
    () => (listQuery.data?.volunteers ?? []).filter((volunteer) => volunteer.active),
    [listQuery.data?.volunteers],
  );

  useEffect(() => {
    document.title = "Volunteer Progress";
  }, []);

  useEffect(() => {
    if (!isManagementRole) {
      setSelectedUserId(null);
      return;
    }
    if (selectedUserId !== null && volunteers.some((volunteer) => volunteer.userId === selectedUserId)) {
      return;
    }
    setSelectedUserId(volunteers[0]?.userId ?? null);
  }, [isManagementRole, selectedUserId, volunteers]);

  const volunteerOptions = useMemo(
    () =>
      volunteers.map((volunteer) => {
        const fullName = `${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email;
        return {
          value: String(volunteer.userId),
          label: `${fullName} · ${volunteer.starsEarned}/${volunteer.totalStars} stars`,
        };
      }),
    [volunteers],
  );

  const activeQuery = isManagementRole ? selectedProgressQuery : myProgressQuery;
  const detail = activeQuery.data;
  const isLoading = isManagementRole
    ? listQuery.isLoading || (selectedUserId !== null && selectedProgressQuery.isLoading)
    : myProgressQuery.isLoading;
  const queryError = listQuery.error ?? activeQuery.error;

  const handleRefresh = async () => {
    if (!canLoadMilestones) {
      return;
    }
    if (isManagementRole) {
      await Promise.all([listQuery.refetch(), selectedUserId === null ? Promise.resolve() : selectedProgressQuery.refetch()]);
      return;
    }
    await myProgressQuery.refetch();
  };

  const moveMonth = (amount: number) => {
    setPeriod((current) => moveVolunteerProgressMonth(current, amount));
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.volunteerProgress}>
    <Box maw={1440} w="100%" mx="auto" pb="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" gap="md">
          <Box>
            <Title order={1}>Volunteer progress</Title>
            <Text c="dimmed" mt={4} maw={760}>
              A transparent, five-star path toward your monthly Workpackers review. Every star shows its target, live progress, and the evidence behind it.
            </Text>
          </Box>
          <Tooltip label="Refresh progress" withArrow>
            <ActionIcon
              variant="light"
              size="lg"
              radius="xl"
              onClick={handleRefresh}
              loading={activeQuery.isFetching || listQuery.isFetching}
              disabled={!canLoadMilestones}
              aria-label="Refresh volunteer progress"
            >
              <IconRefresh size={19} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Paper withBorder radius="xl" p="md">
          <Group justify="space-between" align="end" gap="md">
            {isManagementRole ? (
              <Select
                label="Volunteer"
                description="Choose an active volunteer to review"
                placeholder={listQuery.isLoading ? "Loading volunteers…" : "Select a volunteer"}
                data={volunteerOptions}
                value={selectedUserId === null ? null : String(selectedUserId)}
                onChange={(value) => setSelectedUserId(value ? Number(value) : null)}
                searchable
                disabled={listQuery.isLoading || volunteerOptions.length === 0}
                w={{ base: "100%", sm: 360 }}
              />
            ) : (
              <Box>
                <Text size="xs" fw={800} c="dimmed" tt="uppercase" lts={0.7}>
                  Your progress month
                </Text>
                <Text fw={700}>Stars reset and are earned independently each month.</Text>
              </Box>
            )}

            <Group gap="xs" wrap="nowrap">
              <ActionIcon
                variant="default"
                size="lg"
                radius="xl"
                onClick={() => moveMonth(-1)}
                aria-label="View previous month"
              >
                <IconChevronLeft size={19} aria-hidden="true" />
              </ActionIcon>
              <Box miw={150} ta="center">
                <Text fw={800}>{formatVolunteerProgressMonth(period)}</Text>
                <Text size="xs" c="dimmed">
                  {period === currentMonth ? "Current month" : "Past month"}
                </Text>
              </Box>
              <ActionIcon
                variant="default"
                size="lg"
                radius="xl"
                onClick={() => moveMonth(1)}
                disabled={period >= currentMonth}
                aria-label="View next month"
              >
                <IconChevronRight size={19} aria-hidden="true" />
              </ActionIcon>
            </Group>
          </Group>
        </Paper>

        {milestoneAccess.ready && !milestoneAccess.canView ? (
          <Alert color="yellow" title="No milestone access" icon={<IconAlertCircle size={20} />}>
            You do not have permission to view volunteer milestone data. Contact an administrator if you need access.
          </Alert>
        ) : queryError && (
          <Alert
            color="red"
            title="Progress could not be loaded"
            icon={<IconAlertCircle size={20} />}
          >
            <Group justify="space-between" gap="sm">
              <Text size="sm">
                {getVolunteerMilestoneErrorMessage(queryError)}
              </Text>
              <Button variant="light" color="red" size="xs" onClick={handleRefresh}>
                Try again
              </Button>
            </Group>
          </Alert>
        )}

        {canViewMilestones && !isManagementRole && !isActiveVolunteer ? (
          <Alert color="blue" title="Volunteer milestones are not applicable" icon={<IconInfoCircle size={20} />}>
            This five-star path is available to active volunteers. Your other Omnilodge tools are unchanged.
          </Alert>
        ) : canLoadMilestones && isLoading ? (
          <Center mih={360}>
            <Stack align="center" gap="sm">
              <Loader variant="dots" />
              <Text c="dimmed">Loading milestone progress…</Text>
            </Stack>
          </Center>
        ) : canLoadMilestones && isManagementRole && volunteers.length === 0 && !listQuery.isError ? (
          <Paper withBorder radius="xl" p="xl">
            <Center mih={220}>
              <Stack align="center" gap="xs" maw={520} ta="center">
                <ThemeIcon size={52} radius="xl" variant="light" color="gray">
                  <IconUserCheck size={28} aria-hidden="true" />
                </ThemeIcon>
                <Title order={2} size="h3">
                  No active volunteers
                </Title>
                <Text c="dimmed">
                  Active volunteer profiles will appear here as soon as they are available.
                </Text>
              </Stack>
            </Center>
          </Paper>
        ) : canLoadMilestones && detail ? (
          <>
            <ProgressHero detail={detail} />

            {detail.milestones.length === 0 ? (
              <Alert color="blue" icon={<IconInfoCircle size={20} />}>
                Milestones have not been configured for this month yet.
              </Alert>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2, xl: 5 }} spacing="md" verticalSpacing="md">
                {orderVolunteerMilestones(detail.milestones).map((milestone, index) => (
                  <MilestoneCard
                    key={`${detail.user.id}-${detail.period.month}-${milestone.key}`}
                    milestone={milestone}
                    index={index}
                    periodTimezone={detail.period.timezone}
                  />
                ))}
              </SimpleGrid>
            )}

            <VolunteerFeedbackSummary detail={detail} />

            <Alert color="blue" variant="light" icon={<IconInfoCircle size={20} />} radius="lg">
              Progress is based on activity recorded in Omnilodge through {dayjs(detail.period.asOfDate).format("D MMMM YYYY")} ({detail.period.timezone}). If something looks wrong, ask management to review the evidence before the month is finalized.
            </Alert>

            {isManagementRole && milestoneAccess.ready && !canEdit && (
              <Alert color="blue" variant="light" icon={<IconInfoCircle size={20} />}>
                You have read-only access to volunteer progress. An administrator can grant update access if you need to confirm attendance or save final feedback.
              </Alert>
            )}

            {canEdit && <ManagementWorkspace detail={detail} />}
          </>
        ) : canLoadMilestones && !queryError && !isLoading ? (
          <Alert color="blue" icon={<IconInfoCircle size={20} />}>
            {isManagementRole
              ? "Select a volunteer to view their progress."
              : "No volunteer milestone record is available for this month yet."}
          </Alert>
        ) : null}
      </Stack>
    </Box>
    </PageAccessGuard>
  );
};

const VolunteerProgress = () => {
  const [mode, setMode] = useState("stay");
  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.volunteerProgress}>
      <Box maw={1440} w="100%" mx="auto" pb="xl">
        <Stack gap="lg">
          <SegmentedControl
            value={mode}
            onChange={setMode}
            data={[{ value: "stay", label: "Stay progress" }, { value: "calendar", label: "Calendar history" }]}
            aria-label="Progress view"
          />
          {mode === "calendar" ? <LegacyVolunteerProgress /> : (
            <VolunteerStayProgress renderProgress={(detail, canEdit) => (
              <>
                <ProgressHero detail={detail} />
                <SimpleGrid cols={{ base: 1, md: 2, xl: 5 }} spacing="md">
                  {orderVolunteerMilestones(detail.milestones).map((milestone, index) => (
                    <MilestoneCard key={`${detail.stay?.id}-${milestone.key}`} milestone={milestone} index={index} periodTimezone={detail.timezone} />
                  ))}
                </SimpleGrid>
                <VolunteerFeedbackSummary detail={detail} />
                {canEdit ? <ManagementWorkspace key={`stay-${detail.stay?.id}`} detail={detail} /> : null}
              </>
            )} />
          )}
        </Stack>
      </Box>
    </PageAccessGuard>
  );
};

export default VolunteerProgress;
