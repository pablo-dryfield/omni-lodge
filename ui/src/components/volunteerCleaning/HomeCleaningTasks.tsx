import { Alert, Badge, Button, Group, Modal, Paper, Progress, SimpleGrid, Stack, Text, Textarea, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCamera, IconChecklist, IconRefresh } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useState } from "react";
import { type CleaningTaskIssue, getCleaningError, useCleaningCachedDataBlocked, useMyCleaningSubmissions, useWaiveCanceledCleaningTask } from "../../api/volunteerCleaning";
import { useAppSelector } from "../../store/hooks";
import CleaningReviewAction from "./CleaningReviewAction";
import CleaningSubmissionForm from "./CleaningSubmissionForm";

const HomeCleaningTasks = () => {
  const authenticated = useAppSelector((state) => state.session.authenticated);
  const userId = useAppSelector((state) => state.session.loggedUserId);
  const query = useMyCleaningSubmissions(authenticated, userId);
  const cachedDataBlocked = useCleaningCachedDataBlocked(query.error, query.isSuccess);
  const waive = useWaiveCanceledCleaningTask(userId);
  const mobile = useMediaQuery("(max-width: 48em)");
  const [selection, setSelection] = useState<{ id: number; review: boolean } | null>(null);
  const [waiveIssue, setWaiveIssue] = useState<CleaningTaskIssue | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [waiveError, setWaiveError] = useState<string | null>(null);
  const confirmWaiver = async () => {
    if (!waiveIssue || waive.isPending) return;
    if (!waiveReason.trim()) { setWaiveError("Enter why this cleaning work was canceled."); return; }
    setWaiveError(null);
    try {
      await waive.mutateAsync({ taskLogId: waiveIssue.taskLogId, reason: waiveReason.trim(), expectedUpdatedAt: waiveIssue.updatedAt });
      setWaiveIssue(null);
      setWaiveReason("");
    } catch (error) { setWaiveError(getCleaningError(error, "Unable to waive this task. Refresh cleaning and try again.")); }
  };
  if (!authenticated) return null;
  if (cachedDataBlocked || (query.error && !query.data)) return <Alert color="red" title="Cleaning tasks unavailable">
    <Group justify="space-between"><Text size="sm">{getCleaningError(query.error)}</Text><Button size="xs" variant="light" onClick={() => void query.refetch()} disabled={query.isFetching} loading={query.isFetching}>Retry</Button></Group>
  </Alert>;
  const refreshWarning = query.error ? <Alert color="yellow" title="Cleaning refresh interrupted">
    <Stack gap="xs">
      <Text size="sm">{getCleaningError(query.error, "Unable to refresh cleaning tasks right now.")} Showing saved details; your selected photos are kept.</Text>
      <Button size="xs" variant="subtle" onClick={() => void query.refetch()} disabled={query.isFetching} loading={query.isFetching}>Retry cleaning refresh</Button>
    </Stack>
  </Alert> : null;
  const own = query.data?.submissions.filter((submission) => submission.status !== "approved") ?? [];
  const reviews = query.data?.reviewSubmissions ?? [];
  const issues = query.data?.taskIssues ?? [];
  const selected = query.data?.submissions.find((submission) => submission.id === selection?.id);
  if (!own.length && !reviews.length && !issues.length && !selection && !waiveIssue) return null;

  return <>
    {!selection && !waiveIssue ? refreshWarning : null}
    {own.length || reviews.length || issues.length ? <Paper component="section" aria-label="Cleaning tasks" withBorder radius="lg" p={{ base: "sm", sm: "lg" }}>
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Title order={2} size="h3">Cleaning</Title>
          <Group gap="xs">
            {own.length ? <Badge variant="light">{own.length} assigned</Badge> : null}
            {reviews.length ? <Badge color="orange">{reviews.length} to review</Badge> : null}
            <Button size="compact-sm" variant="subtle" leftSection={<IconRefresh size={15} />} aria-label="Refresh cleaning" onClick={() => void query.refetch()} disabled={query.isFetching} loading={query.isFetching}>Refresh</Button>
          </Group>
        </Group>
        {issues.map((issue) => <Alert key={issue.taskLogId} color="orange" title={`${issue.title} · ${dayjs(issue.taskDate).format("D MMM")}`}>
          <Stack gap="sm">
            <Text size="sm">{issue.message}</Text>
            <Group gap="xs" justify="center" wrap="wrap">
              <Button component="a" href={`/assistant-manager-tasks?section=dashboard&task=${issue.taskLogId}`} size="xs" variant="subtle">View task</Button>
              {issue.code === "no_active_cleaners" && issue.canWaive ? <Button size="xs" variant="light" color="orange" onClick={() => {
                setWaiveIssue(issue); setWaiveReason(""); setWaiveError(null);
              }}>Waive canceled cleaning</Button> : null}
            </Group>
          </Stack>
        </Alert>)}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {own.map((submission) => {
            const approved = submission.slots.filter((slot) => slot.status === "approved").length;
            const needsRetake = submission.slots.some((slot) => slot.status === "rejected");
            return <Paper key={`own-${submission.id}`} withBorder radius="md" p="md"><Stack gap="sm" ta="center">
              <Text size="sm" c="dimmed">{dayjs(submission.taskDate).format("ddd, D MMM")}</Text>
              <Text fw={700}>{submission.title}</Text>
              {needsRetake ? <Text size="sm" c="red">Photo retake requested</Text> : <Text size="sm" c="dimmed">{approved} / {submission.slots.length} photos approved</Text>}
              <Progress value={submission.slots.length ? approved / submission.slots.length * 100 : 0} color="teal" aria-label={`${approved} of ${submission.slots.length} photos approved`} />
              <Button leftSection={<IconCamera size={17} />} variant={needsRetake ? "filled" : "light"} onClick={() => setSelection({ id: submission.id, review: false })}>
                {needsRetake ? "Retake photos" : submission.canUpload && submission.slots.some((slot) => slot.status === "missing") ? "Add photos" : "View photos"}
              </Button>
            </Stack></Paper>;
          })}
          {reviews.map((submission) => <Paper key={`review-${submission.id}`} withBorder radius="md" p="md"><Stack gap="sm" ta="center">
            <Text size="sm" c="dimmed">{dayjs(submission.taskDate).format("ddd, D MMM")}</Text>
            <Text fw={700}>{submission.subjectName || "Assigned staff member"}</Text>
            <Text size="sm">{submission.title}</Text>
            <Text size="sm" c={submission.reviewerMissing ? "orange" : "dimmed"}>{submission.reviewerMissing ? "Management review needed" : `${submission.slots.filter((slot) => slot.status === "pending").length} photos to review`}</Text>
            <Button color="teal" leftSection={<IconChecklist size={17} />} onClick={() => setSelection({ id: submission.id, review: true })}>Review photos</Button>
          </Stack></Paper>)}
        </SimpleGrid>
      </Stack>
    </Paper> : null}
    <Modal opened={Boolean(selection)} onClose={() => setSelection(null)} title={selection?.review ? "Review cleaning photos" : selected?.title || "Cleaning photos"} size="xl" fullScreen={mobile} centered>
      {selection ? refreshWarning : null}
      {selection?.review ? <CleaningReviewAction key={selection.id} submissionId={selection.id} />
        : selected ? <CleaningSubmissionForm key={selected.id} submission={selected} />
          : <Alert color="teal">There are no outstanding cleaning photos for this assignment.</Alert>}
    </Modal>
    <Modal opened={Boolean(waiveIssue)} onClose={() => { if (!waive.isPending) setWaiveIssue(null); }} closeOnClickOutside={!waive.isPending} closeOnEscape={!waive.isPending} withCloseButton={!waive.isPending} title="Waive canceled cleaning" centered size="md">
      <Stack gap="md">
        {waiveIssue ? refreshWarning : null}
        <Text fw={600} ta="center">{waiveIssue?.title} · {dayjs(waiveIssue?.taskDate).format("D MMM YYYY")}</Text>
        <Text size="sm" ta="center">Only cancel work that is no longer assigned. This does not approve photos or award a completed cleaning shift.</Text>
        <Textarea label="Cancellation reason" required autosize minRows={2} maxRows={5} value={waiveReason} onChange={(event) => setWaiveReason(event.currentTarget.value)} disabled={waive.isPending} />
        {waiveError ? <Alert color="red">{waiveError}</Alert> : null}
        <Group justify="center" wrap="wrap">
          <Button variant="default" disabled={waive.isPending} onClick={() => setWaiveIssue(null)}>Keep task</Button>
          <Button color="orange" loading={waive.isPending} onClick={() => void confirmWaiver()}>Confirm waiver</Button>
        </Group>
      </Stack>
    </Modal>
  </>;
};

export default HomeCleaningTasks;
