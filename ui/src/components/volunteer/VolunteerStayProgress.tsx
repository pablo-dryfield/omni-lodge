import { Alert, Badge, Box, Button, Center, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
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
import { canManageVolunteerProgress, formatVolunteerStayRange } from "../../utils/volunteerMilestones";
import VolunteerStayEditor from "./VolunteerStayEditor";

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
  const report = reportQuery.data;
  const isLoading = !access.ready || (isManager && listQuery.isLoading)
    || ((!isManager || selectedUserId !== null) && reportQuery.isLoading);
  const error = listQuery.error ?? reportQuery.error;

  useEffect(() => {
    document.title = "Volunteer Progress";
  }, []);

  useEffect(() => {
    if (!isManager || volunteers.length === 0) return;
    if (selectedUserId === null || !volunteers.some((entry) => entry.user.id === selectedUserId)) {
      setSelectedUserId(volunteers[0].user.id);
      setSelectedStayId(null);
    }
  }, [isManager, selectedUserId, volunteers]);

  const refresh = () => {
    if (isManager) void listQuery.refetch();
    if (!isManager || selectedUserId !== null) void reportQuery.refetch();
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={1}>Volunteer progress</Title>
          <Text c="dimmed" mt={4}>Your five-star path for the full stay, with goals based on saved dates and position.</Text>
        </Box>
        <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={refresh} loading={reportQuery.isFetching || listQuery.isFetching} disabled={!canView}>
          Refresh
        </Button>
      </Group>
      {canView ? (
        <Paper withBorder radius="xl" p="md">
          <SimpleGrid cols={{ base: 1, sm: isManager ? 2 : 1 }}>
            {isManager ? (
              <Select
                label="Volunteer"
                description="Volunteer profiles and saved previous stays"
                data={volunteers.map(({ user, active }) => ({
                  value: String(user.id),
                  label: `${[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}${active ? "" : " (inactive)"}`,
                }))}
                value={selectedUserId === null ? null : String(selectedUserId)}
                onChange={(value) => {
                  setSelectedUserId(value ? Number(value) : null);
                  setSelectedStayId(null);
                  setSavedMessage(null);
                }}
                searchable
                allowDeselect={false}
                placeholder="Choose a volunteer"
                disabled={listQuery.isLoading || volunteers.length === 0}
              />
            ) : null}
            <Select
              label="Stay"
              description="Arrival through the day before departure"
              data={(report?.stays ?? []).map((stay) => ({ value: String(stay.id), label: `${formatVolunteerStayRange(stay)} · ${stay.position === "guide" ? "Guide" : "Social Media"}` }))}
              value={report?.stay ? String(selectedStayId ?? report.stay.id) : null}
              onChange={(value) => {
                setSelectedStayId(value ? Number(value) : null);
                setSavedMessage(null);
              }}
              allowDeselect={false}
              disabled={!report?.stays.length}
              placeholder="No saved stay"
            />
          </SimpleGrid>
        </Paper>
      ) : null}
      {savedMessage ? <Alert color="teal" withCloseButton onClose={() => setSavedMessage(null)}>{savedMessage}</Alert> : null}
      {error ? <Alert color="red">{getVolunteerMilestoneErrorMessage(error)}</Alert> : null}
      {!access.ready || isLoading ? <Center mih={260}><Loader variant="dots" /></Center> : !canView ? (
        <Alert color="yellow">You do not have permission to view volunteer progress.</Alert>
      ) : report ? (
        <>
          {report.setupRequired || !report.stay ? (
            <Paper withBorder radius="xl" p="xl">
              <Stack gap="sm">
                <Title order={2} size="h3">Stay setup required</Title>
                <Text>Save the arrival date, departure date, position, and monthly targets before calculating goals for this stay.</Text>
                {canEdit ? <Button onClick={() => setEditorMode("new")} style={{ alignSelf: "flex-start" }}>Set up stay</Button>
                  : <Text c="dimmed">Ask a manager to set up your stay. Suggested profile dates do not create a stay automatically.</Text>}
              </Stack>
            </Paper>
          ) : (
            <>
              <Paper withBorder radius="xl" p="md">
                <Group justify="space-between" align="flex-start">
                  <Box>
                    <Group gap="xs"><Text fw={700}>{formatVolunteerStayRange(report.stay)}</Text><Badge>{report.stay.position === "guide" ? "Guide" : "Social Media"}</Badge></Group>
                    <Text size="sm" c="dimmed" mt={4}>Departure date is the end boundary; progress includes arrival through the previous day. Stars apply to the full saved stay.</Text>
                    {report.targetSummary ? <Text size="sm" mt={4}>Full stay: {report.targetSummary.equivalentMonths.toLocaleString("en-GB", { maximumFractionDigits: 2 })} months · Expected progress through {report.asOfDate} ({report.timezone}).</Text> : null}
                  </Box>
                  {canEdit ? <Group gap="xs"><Button variant="light" onClick={() => setEditorMode("edit")}>Edit stay and targets</Button><Button variant="default" onClick={() => setEditorMode("new")}>Add another stay</Button></Group> : null}
                </Group>
              </Paper>
              {report.warnings.map((warning, index) => <Alert key={`${index}-${warning}`} color="yellow">{warning}</Alert>)}
              {renderProgress(report, canEdit)}
              <Text size="sm" c="dimmed">Photo-managed cleaning shifts count only after every required photo is approved. Other cleaning work uses completed tasks or manager-confirmed shifts.</Text>
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
        </>
      ) : !error ? <Alert color="blue">{isManager ? "No volunteer profiles or saved stays are available." : "No stay information is available."}</Alert> : null}
    </Stack>
  );
};

export default VolunteerStayProgress;
