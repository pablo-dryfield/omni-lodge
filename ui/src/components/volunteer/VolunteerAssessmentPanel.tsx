import { Alert, Avatar, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Textarea, Title } from "@mantine/core";
import { IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { useState } from "react";
import { getVolunteerMilestoneErrorMessage, useUpdateVolunteerStayAssessment,
  type StayAssessmentInput, type StayAssessmentReview, type VolunteerStayProgress } from "../../api/volunteerMilestones";
import { useAppSelector } from "../../store/hooks";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";
import { formatVolunteerProgressTimestamp, normalizeVolunteerProgressRole } from "../../utils/volunteerMilestones";

const VoteEditor = ({ initial, pending, onSave }: {
  initial: StayAssessmentReview | null; pending: boolean;
  onSave: (vote: "up" | "down", feedback: string) => Promise<void>;
}) => {
  const [vote, setVote] = useState<"up" | "down" | null>(initial?.vote ?? null);
  const [feedback, setFeedback] = useState(initial?.feedback ?? "");
  return <Stack gap="sm">
    <Group>
      <Button variant={vote === "up" ? "filled" : "light"} color="teal" leftSection={<IconThumbUp size={17} />}
        aria-pressed={vote === "up"} onClick={() => setVote("up")} disabled={pending}>Thumbs up</Button>
      <Button variant={vote === "down" ? "filled" : "light"} color="red" leftSection={<IconThumbDown size={17} />}
        aria-pressed={vote === "down"} onClick={() => setVote("down")} disabled={pending}>Thumbs down</Button>
    </Group>
    <Textarea label="Written feedback" value={feedback} onChange={(event) => setFeedback(event.currentTarget.value)}
      required minRows={3} maxLength={5000} disabled={pending} />
    <Button onClick={() => vote && void onSave(vote, feedback.trim())} disabled={!vote || !feedback.trim()} loading={pending}>Save assessment</Button>
  </Stack>;
};

const WaiverEditor = ({ label, waived, pending, onSave }: {
  label: string; waived: boolean; pending: boolean; onSave: (reason: string) => Promise<void>;
}) => {
  const [reason, setReason] = useState("");
  return <Stack gap="xs">
    <Textarea label={`${waived ? "Restore" : "Waive"} ${label} — reason`} required value={reason}
      onChange={(event) => setReason(event.currentTarget.value)} maxLength={2000} disabled={pending} />
    <Button color="orange" variant="light" loading={pending} disabled={!reason.trim()} onClick={() => void onSave(reason.trim())}>
      {waived ? "Restore" : "Waive"} {label}
    </Button>
  </Stack>;
};

const VolunteerAssessmentPanel = ({ report, canEdit }: { report: VolunteerStayProgress; canEdit: boolean }) => {
  const actorId = useAppSelector((state) => state.session.loggedUserId);
  const role = useAppSelector((state) => state.session.roleSlug);
  const elevated = canEdit && ["owner", "admin"].includes(normalizeVolunteerProgressRole(role));
  const mutation = useUpdateVolunteerStayAssessment();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const assessment = report.assessment;
  const stay = report.stay;
  if (!assessment || !stay) return null;
  const notSelf = actorId !== report.user.id;
  const noRequiredReviewers = assessment.reviewers.every((reviewer) => reviewer.waiver);
  const cleaning = report.milestones.find((item) => item.key === "cleaning");
  const save = async (action: Omit<Extract<StayAssessmentInput, { action: "review" | "fallback" }>, "userId" | "stayId" | "expectedRevision">
    | Omit<Extract<StayAssessmentInput, { action: "waive-reviewer" }>, "userId" | "stayId" | "expectedRevision">
    | Omit<Extract<StayAssessmentInput, { action: "waive-cleaning" }>, "userId" | "stayId" | "expectedRevision">) => {
    setError(null); setSaved(false);
    try {
      await mutation.mutateAsync({ userId: report.user.id, stayId: stay.id, expectedRevision: stay.revision, ...action });
      setSaved(true);
    } catch (failure) { setError(getVolunteerMilestoneErrorMessage(failure)); }
  };
  return <Paper withBorder radius="xl" p="lg">
    <Stack gap="md">
      <Group justify="space-between"><Title order={2} size="h3">Management assessment</Title>
        <Badge color={assessment.earned ? "teal" : "blue"}>{assessment.earned ? "Star earned" : "Not earned"}</Badge></Group>
      <Text size="sm">Independent of the other four stars. Every required shift manager must submit written feedback and a vote.
        Half or more thumbs up earns the star; ties are positive. One vote per manager, regardless of shared-shift count.</Text>
      <Text fw={700}>{assessment.upCount} thumbs up · {assessment.downCount} thumbs down · {assessment.pendingCount} pending · {assessment.waivedCount} waived</Text>
      {report.managementFeedback?.feedback && <Alert color="gray" title="Previous management feedback">
        {report.managementFeedback.feedback} — Saved before shift-manager voting; retained as history, not counted as a vote.
      </Alert>}
      {assessment.pendingCount > 0 && <Alert color="blue">Waiting for all required managers. Pending feedback is not a negative vote.</Alert>}
      {assessment.reviewers.length === 0 && <Text>No shift managers were found on this volunteer’s attended shifts within the saved stay.</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {assessment.reviewers.map((reviewer) => <Paper key={reviewer.userId} withBorder radius="lg" p="md">
          <Stack gap="sm">
            <Group><Avatar radius="xl" size={52} alt={`${reviewer.firstName} ${reviewer.lastName} profile photo`}
              src={buildUserProfilePhotoUrl({ user: { ...reviewer, id: reviewer.userId }, cacheOverride: reviewer.profilePhotoVersion ?? undefined,
                resourcePath: `/volunteerMilestones/${report.user.id}/stays/${stay.id}/reviewers/${reviewer.userId}/profile-photo` }) ?? undefined}>
              {reviewer.firstName.charAt(0)}{reviewer.lastName.charAt(0)}</Avatar>
              <Stack gap={2}><Text fw={700}>{reviewer.firstName} {reviewer.lastName}</Text>
                <Text size="sm">Worked together on {reviewer.sharedShiftCount} {reviewer.sharedShiftCount === 1 ? "shift" : "shifts"}</Text></Stack></Group>
            <Badge color={reviewer.waiver ? "orange" : reviewer.review ? "teal" : "gray"}>
              {reviewer.waiver ? "Waived" : reviewer.review ? "Submitted" : "Pending"}</Badge>
            {reviewer.waiver && <Text size="sm">Waived by user #{reviewer.waiver.actorId} on {formatVolunteerProgressTimestamp(reviewer.waiver.updatedAt, report.timezone)}: {reviewer.waiver.reason}</Text>}
            {reviewer.review && <><Text fw={600}>{reviewer.review.vote === "up" ? "👍 Thumbs up" : "👎 Thumbs down"}</Text>
              <Text style={{ whiteSpace: "pre-wrap" }}>{reviewer.review.feedback}</Text>
              <Text size="xs" c="dimmed">Submitted {formatVolunteerProgressTimestamp(reviewer.review.updatedAt, report.timezone)}</Text></>}
            {canEdit && notSelf && reviewer.userId === actorId && !reviewer.waiver && <VoteEditor
              key={reviewer.review?.updatedAt ?? "new"} initial={reviewer.review} pending={mutation.isPending}
              onSave={(vote, feedback) => save({ action: "review", vote, feedback })} />}
            {elevated && notSelf && <WaiverEditor key={reviewer.waiver?.updatedAt ?? "waive"} label="reviewer requirement" waived={Boolean(reviewer.waiver)} pending={mutation.isPending}
              onSave={(reason) => save({ action: "waive-reviewer", reviewerId: reviewer.userId, waived: !reviewer.waiver, reason })} />}
          </Stack>
        </Paper>)}
      </SimpleGrid>
      {noRequiredReviewers && <>
        <Alert color="orange">{assessment.needsFallback ? "No votes are available. Waivers do not automatically earn a star; an owner/admin must provide an explicit assessment."
          : "With no required voters, the star follows the explicit owner/admin assessment below."}</Alert>
        {assessment.fallback && <Text>Owner/admin assessment: {assessment.fallback.vote === "up" ? "👍" : "👎"} {assessment.fallback.feedback}</Text>}
        {elevated && notSelf && <VoteEditor key={assessment.fallback?.updatedAt ?? "fallback"} initial={assessment.fallback} pending={mutation.isPending}
          onSave={(vote, feedback) => save({ action: "fallback", vote, feedback })} />}
      </>}
      {cleaning?.target === 0 && <>
        <Title order={3} size="h4">No cleaning assigned</Title>
        <Text size="sm">{report.cleaningWaiver ? `Requirement waived: ${report.cleaningWaiver.reason}` : "This does not automatically earn the cleaning star. Management may record a waiver with a reason."}</Text>
        {canEdit && notSelf && <WaiverEditor key={report.cleaningWaiver?.updatedAt ?? "waive-cleaning"} label="cleaning requirement" waived={Boolean(report.cleaningWaiver)} pending={mutation.isPending}
          onSave={(reason) => save({ action: "waive-cleaning", waived: !report.cleaningWaiver, reason })} />}
      </>}
      {saved && <Alert color="teal">Assessment saved and progress recalculated.</Alert>}
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  </Paper>;
};
export default VolunteerAssessmentPanel;
