import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconArrowRight,
  IconRefresh,
  IconStar,
  IconStarFilled,
  IconUserCheck,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getVolunteerMilestoneErrorMessage,
  useVolunteerStayList,
  useVolunteerStayProgress,
  type VolunteerStayProgress as StayReport,
} from "../../api/volunteerMilestones";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useAppSelector } from "../../store/hooks";
import {
  canManageVolunteerProgress,
  formatVolunteerStayRange,
  getVolunteerProfilePhotoUrl,
  orderVolunteerMilestones,
} from "../../utils/volunteerMilestones";
import VolunteerStayEditor from "./VolunteerStayEditor";

type StayStatus = "setup" | "current" | "upcoming" | "past";

const getInitials = (report: StayReport) =>
  `${report.user.firstName.charAt(0)}${report.user.lastName.charAt(0)}`.toUpperCase() || "V";

const getFullName = (report: StayReport) =>
  [report.user.firstName, report.user.lastName].filter(Boolean).join(" ") || report.user.email;

const getStayStatus = (report: StayReport): StayStatus => {
  if (report.setupRequired || !report.stay) return "setup";
  if (report.stay.startDate > report.asOfDate) return "upcoming";
  if (report.stay.endDate <= report.asOfDate) return "past";
  return "current";
};

const stayStatusMeta: Record<StayStatus, { label: string; color: string }> = {
  setup: { label: "Needs setup", color: "orange" },
  current: { label: "Current stay", color: "teal" },
  upcoming: { label: "Upcoming", color: "blue" },
  past: { label: "Previous stay", color: "gray" },
};

const positionLabel = (report: StayReport) =>
  (report.stay?.position ?? report.suggestedStay.position) === "guide" ? "Guide" : "Social Media";

const stayRangeLabel = (report: StayReport) => {
  if (report.stay) return formatVolunteerStayRange(report.stay);
  if (report.suggestedStay.startDate && report.suggestedStay.endDate) {
    return `${formatVolunteerStayRange({
      startDate: report.suggestedStay.startDate,
      endDate: report.suggestedStay.endDate,
    })} · suggested`;
  }
  return "Stay dates need to be set";
};

const compareVolunteerNames = (left: StayReport, right: StayReport) =>
  getFullName(left).localeCompare(getFullName(right), undefined, { sensitivity: "base" });

const VolunteerOverviewCard = ({
  report,
  onOpen,
}: {
  report: StayReport;
  onOpen: () => void;
}) => {
  const status = getStayStatus(report);
  const statusMeta = stayStatusMeta[status];
  const milestones = orderVolunteerMilestones(report.milestones);

  return (
    <Card
      component="button"
      type="button"
      withBorder
      radius="xl"
      padding="lg"
      onClick={onOpen}
      aria-label={`View ${getFullName(report)} volunteer progress`}
      styles={{
        root: {
          width: "100%",
          minHeight: 218,
          textAlign: "left",
          cursor: "pointer",
          background: "var(--mantine-color-body)",
          transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
        },
      }}
      style={{ borderTop: `4px solid var(--mantine-color-${statusMeta.color}-5)` }}
    >
      <Stack gap="md" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Avatar
              src={getVolunteerProfilePhotoUrl(report.user) ?? undefined}
              size={58}
              radius="xl"
              color="blue"
              alt={`${getFullName(report)} profile photo`}
              style={{ flexShrink: 0 }}
            >
              {getInitials(report)}
            </Avatar>
            <Box style={{ minWidth: 0 }}>
              <Text fw={800} size="lg" lineClamp={1}>
                {getFullName(report)}
              </Text>
              <Group gap={6} mt={5}>
                <Badge color={statusMeta.color} variant="light" size="sm">
                  {statusMeta.label}
                </Badge>
                <Badge color="violet" variant="light" size="sm">
                  {positionLabel(report)}
                </Badge>
                {!report.active ? (
                  <Badge color="gray" variant="outline" size="sm">
                    Inactive
                  </Badge>
                ) : null}
              </Group>
            </Box>
          </Group>
        </Group>

        <Text size="sm" c={status === "setup" ? "orange.8" : "dimmed"} fw={status === "setup" ? 650 : 500}>
          {stayRangeLabel(report)}
        </Text>

        <Box mt="auto">
          <Group justify="space-between" align="center" gap="sm">
            <Group
              gap={5}
              wrap="nowrap"
              role="img"
              aria-label={`${report.starsEarned} of ${report.totalStars} stars earned`}
            >
              {Array.from({ length: report.totalStars }, (_, index) => {
                const milestone = milestones[index];
                const earned = milestone?.earned ?? false;
                return (
                  <Tooltip
                    key={milestone?.key ?? index}
                    label={milestone ? `${milestone.title}: ${earned ? "earned" : "in progress"}` : "Not configured"}
                    withArrow
                  >
                    <ThemeIcon
                      size={30}
                      radius="xl"
                      variant={earned ? "filled" : "light"}
                      color={earned ? "yellow" : status === "setup" ? "gray" : "blue"}
                    >
                      {earned ? <IconStarFilled size={17} aria-hidden="true" /> : <IconStar size={17} aria-hidden="true" />}
                    </ThemeIcon>
                  </Tooltip>
                );
              })}
            </Group>
            <Text size="sm" fw={800} c={report.starsEarned === report.totalStars ? "teal.7" : undefined}>
              {report.starsEarned}/{report.totalStars}
            </Text>
          </Group>
          <Group justify="space-between" mt="md" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Text size="sm" fw={700} c="blue.7">
              {status === "setup" ? "Set up stay" : "View full progress"}
            </Text>
            <IconArrowRight size={18} color="var(--mantine-color-blue-7)" aria-hidden="true" />
          </Group>
        </Box>
      </Stack>
    </Card>
  );
};

const VolunteerGroup = ({
  title,
  reports,
  onOpen,
}: {
  title: string;
  reports: StayReport[];
  onOpen: (report: StayReport) => void;
}) => {
  if (reports.length === 0) return null;
  return (
    <Box component="section" aria-label={title}>
      <Group gap="xs" mb="sm">
        <Title order={2} size="h3">{title}</Title>
        <Badge variant="light" color="gray" radius="xl">{reports.length}</Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md" verticalSpacing="md">
        {reports.map((report) => (
          <VolunteerOverviewCard
            key={report.user.id}
            report={report}
            onOpen={() => onOpen(report)}
          />
        ))}
      </SimpleGrid>
    </Box>
  );
};

const VolunteerStayProgress = ({
  renderProgress,
}: {
  renderProgress: (report: StayReport, canEdit: boolean) => ReactNode;
}) => {
  const role = useAppSelector((state) => state.session.roleSlug);
  const access = useModuleAccess(PAGE_SLUGS.volunteerProgress);
  const isManager = canManageVolunteerProgress(role);
  const canView = access.ready && access.canView;
  const canEdit = isManager && canView && access.canUpdate;
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedStayId, setSelectedStayId] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<"new" | "edit" | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const listQuery = useVolunteerStayList(canView && isManager);
  const reportQuery = useVolunteerStayProgress(
    isManager ? selectedUserId : null,
    selectedStayId,
    canView && (!isManager || selectedUserId !== null),
  );
  const volunteers = useMemo(() => listQuery.data?.volunteers ?? [], [listQuery.data?.volunteers]);
  const report = reportQuery.data && (!isManager || reportQuery.data.user.id === selectedUserId)
    ? reportQuery.data
    : undefined;

  const volunteerGroups = useMemo(() => {
    const current: StayReport[] = [];
    const setup: StayReport[] = [];
    const history: StayReport[] = [];
    volunteers.forEach((volunteer) => {
      const status = getStayStatus(volunteer);
      if (volunteer.active && (status === "current" || status === "upcoming")) current.push(volunteer);
      else if (volunteer.active && status === "setup") setup.push(volunteer);
      else history.push(volunteer);
    });
    current.sort((left, right) => {
      const statusDifference = (getStayStatus(left) === "current" ? 0 : 1) - (getStayStatus(right) === "current" ? 0 : 1);
      return statusDifference || compareVolunteerNames(left, right);
    });
    setup.sort(compareVolunteerNames);
    history.sort((left, right) => {
      const leftDate = left.stay?.endDate ?? left.suggestedStay.endDate ?? "";
      const rightDate = right.stay?.endDate ?? right.suggestedStay.endDate ?? "";
      return rightDate.localeCompare(leftDate) || compareVolunteerNames(left, right);
    });
    return { current, setup, history };
  }, [volunteers]);

  useEffect(() => {
    document.title = "Volunteer Progress";
  }, []);

  const refresh = () => {
    if (isManager) void listQuery.refetch();
    if (!isManager || selectedUserId !== null) void reportQuery.refetch();
  };

  const openVolunteer = (summary: StayReport) => {
    setSelectedUserId(summary.user.id);
    setSelectedStayId(summary.stay?.id ?? null);
    setSavedMessage(null);
  };

  const closeVolunteer = () => {
    setEditorMode(null);
    setSavedMessage(null);
    setSelectedUserId(null);
    setSelectedStayId(null);
  };

  const detailContent = report ? (
    <Stack gap="lg">
      {savedMessage ? <Alert color="teal" withCloseButton onClose={() => setSavedMessage(null)}>{savedMessage}</Alert> : null}
      {report.setupRequired || !report.stay ? (
        <Paper withBorder radius="xl" p="xl">
          <Stack gap="sm" align={isMobile ? "stretch" : "flex-start"}>
            <Title order={2} size="h3">Stay setup required</Title>
            <Text>Save the arrival date, departure date, position, and monthly targets before calculating goals for this stay.</Text>
            {canEdit ? <Button onClick={() => setEditorMode("new")}>Set up stay</Button>
              : <Text c="dimmed">Ask a manager to set up your stay.</Text>}
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper withBorder radius="xl" p="md">
            <Group justify="space-between" align="flex-start" gap="md">
              <Box>
                <Group gap="xs">
                  <Text fw={700}>{formatVolunteerStayRange(report.stay)}</Text>
                  <Badge>{report.stay.position === "guide" ? "Guide" : "Social Media"}</Badge>
                </Group>
                {report.targetSummary ? (
                  <Text size="sm" mt={4} c="dimmed">
                    {report.targetSummary.equivalentMonths.toLocaleString("en-GB", { maximumFractionDigits: 2 })} {report.targetSummary.equivalentMonths === 1 ? "month" : "months"} equivalent · progress through {report.asOfDate}
                  </Text>
                ) : null}
                <Text size="xs" c="dimmed" mt={3}>
                  Progress includes the arrival date through the day before departure.
                </Text>
              </Box>
              {canEdit ? (
                <Group gap="xs">
                  <Button variant="light" onClick={() => setEditorMode("edit")}>Edit stay</Button>
                  <Button variant="default" onClick={() => setEditorMode("new")}>Add stay</Button>
                </Group>
              ) : null}
            </Group>
            {report.stays.length > 1 ? (
              <Select
                label="Stay"
                data={report.stays.map((stay) => ({
                  value: String(stay.id),
                  label: `${formatVolunteerStayRange(stay)} · ${stay.position === "guide" ? "Guide" : "Social Media"}`,
                }))}
                value={String(selectedStayId ?? report.stay.id)}
                onChange={(value) => {
                  setSelectedStayId(value ? Number(value) : null);
                  setSavedMessage(null);
                }}
                allowDeselect={false}
                mt="md"
              />
            ) : null}
          </Paper>
          {report.warnings.map((warning, index) => <Alert key={`${index}-${warning}`} color="yellow">{warning}</Alert>)}
          {renderProgress(report, canEdit)}
          <Text size="sm" c="dimmed">
            Photo-managed cleaning shifts count only after every required photo is approved. Other cleaning work uses completed tasks or manager-confirmed shifts.
          </Text>
        </>
      )}
      {isManager && !canEdit ? <Alert color="blue">You have read-only access to volunteer progress.</Alert> : null}
      {editorMode && canEdit ? (
        <VolunteerStayEditor
          key={`${report.user.id}-${editorMode}`}
          report={{ ...report, shiftTypes: report.shiftTypes ?? listQuery.data?.shiftTypes ?? [] }}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
          onSaved={(saved) => {
            setSelectedStayId(saved.stay?.id ?? null);
            setEditorMode(null);
            setSavedMessage("Stay saved and progress recalculated.");
          }}
        />
      ) : null}
    </Stack>
  ) : null;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Box>
          <Title order={1}>Volunteer progress</Title>
          <Text c="dimmed" mt={4}>
            {isManager ? "All volunteer stays and five-star progress in one place." : "Your five-star path for the full stay."}
          </Text>
        </Box>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={refresh}
          loading={reportQuery.isFetching || listQuery.isFetching}
          disabled={!canView}
        >
          Refresh
        </Button>
      </Group>

      {!access.ready || (isManager && listQuery.isLoading) || (!isManager && reportQuery.isLoading) ? (
        <Center mih={260}><Loader variant="dots" /></Center>
      ) : !canView ? (
        <Alert color="yellow">You do not have permission to view volunteer progress.</Alert>
      ) : isManager ? (
        <>
          {listQuery.error && volunteers.length > 0 ? (
            <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
              The latest progress could not be refreshed. Showing the most recently loaded volunteer overview.
            </Alert>
          ) : null}
          {listQuery.error && volunteers.length === 0 ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {getVolunteerMilestoneErrorMessage(listQuery.error)}
            </Alert>
          ) : volunteers.length === 0 ? (
            <Paper withBorder radius="xl" p="xl">
              <Center mih={220}>
                <Stack align="center" gap="xs" ta="center">
                  <ThemeIcon size={52} radius="xl" variant="light" color="gray">
                    <IconUserCheck size={28} aria-hidden="true" />
                  </ThemeIcon>
                  <Title order={2} size="h3">No volunteer stays</Title>
                  <Text c="dimmed">Volunteer profiles and saved stays will appear here.</Text>
                </Stack>
              </Center>
            </Paper>
          ) : (
            <Stack gap="xl">
              <VolunteerGroup title="Current & upcoming" reports={volunteerGroups.current} onOpen={openVolunteer} />
              <VolunteerGroup title="Needs setup" reports={volunteerGroups.setup} onOpen={openVolunteer} />
              <VolunteerGroup title="Previous & inactive" reports={volunteerGroups.history} onOpen={openVolunteer} />
            </Stack>
          )}

          <Modal
            opened={selectedUserId !== null}
            onClose={closeVolunteer}
            fullScreen={isMobile}
            size="95%"
            radius={isMobile ? 0 : "xl"}
            padding={isMobile ? "md" : "xl"}
            title={report ? (
              <Group gap="sm" wrap="nowrap">
                <Avatar
                  src={getVolunteerProfilePhotoUrl(report.user) ?? undefined}
                  size={42}
                  radius="xl"
                  color="blue"
                  alt={`${getFullName(report)} profile photo`}
                >
                  {getInitials(report)}
                </Avatar>
                <Box>
                  <Text fw={800}>{getFullName(report)}</Text>
                  <Text size="xs" c="dimmed">Volunteer stay progress</Text>
                </Box>
              </Group>
            ) : "Volunteer progress"}
            styles={{ body: { paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" } }}
          >
            {reportQuery.isLoading || !report ? (
              reportQuery.error ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  <Stack gap="sm">
                    <Text>{getVolunteerMilestoneErrorMessage(reportQuery.error)}</Text>
                    <Button variant="light" color="red" onClick={() => reportQuery.refetch()}>Try again</Button>
                  </Stack>
                </Alert>
              ) : <Center mih={260}><Loader variant="dots" /></Center>
            ) : detailContent}
          </Modal>
        </>
      ) : reportQuery.error ? (
        <Alert color="red">{getVolunteerMilestoneErrorMessage(reportQuery.error)}</Alert>
      ) : report ? detailContent : (
        <Alert color="blue">No stay information is available.</Alert>
      )}
    </Stack>
  );
};

export default VolunteerStayProgress;
