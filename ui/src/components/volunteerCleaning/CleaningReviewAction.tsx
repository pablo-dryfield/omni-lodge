import { Alert, Badge, Button, Center, Group, Loader, Paper, Stack, Text, Textarea, Title } from "@mantine/core";
import { useRef, useState } from "react";
import { getCleaningError, useCleaningCachedDataBlocked, useCleaningSubmission, useReviewCleaningPhoto, type CleaningPhotoSlot, type CleaningSubmission } from "../../api/volunteerCleaning";
import CleaningPhotoPreview from "./CleaningPhotoPreview";
import { cleaningStatus } from "./CleaningSubmissionForm";
import { useAppSelector } from "../../store/hooks";

const ReviewPhoto = ({ slot, submission, onMessage, escalationReason, busy, acquire, release }: {
  slot: CleaningPhotoSlot; submission: CleaningSubmission; onMessage: (message: string) => void;
  escalationReason: string; busy: boolean; acquire: () => boolean; release: () => void;
}) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const actorId = useAppSelector((state) => state.session.loggedUserId);
  const review = useReviewCleaningPhoto(actorId);
  const photo = slot.currentVersion;
  const decide = async (decision: "approved" | "rejected") => {
    if (!photo) return;
    if (decision === "rejected" && !reason.trim()) {
      setError("Explain what needs to be retaken.");
      return;
    }
    if (submission.reviewerMissing && !escalationReason.trim()) {
      setError("Enter a management review reason above.");
      return;
    }
    if (!acquire()) return;
    setError(null);
    try {
      const result = await review.mutateAsync({ submissionId: submission.id, photoId: photo.id, expectedRevision: submission.revision, decision,
        ...(decision === "rejected" ? { reason: reason.trim() } : {}),
        ...(submission.reviewerMissing ? { escalationReason: escalationReason.trim() } : {}),
      });
      onMessage(result.taskCompleted ? "All photos approved. The cleaning task is now complete." : decision === "approved" ? "Photo approved. Other photos are unchanged." : "Retake requested. Approved photos are kept.");
    } catch (reviewError) { setError(getCleaningError(reviewError, "Unable to save this photo review.")); }
    finally { release(); }
  };
  return <Paper withBorder radius="md" p="md"><Stack gap="sm">
    <Group justify="space-between"><Title order={3} size="h5">{slot.label}</Title><Badge color={cleaningStatus[slot.status].color}>{cleaningStatus[slot.status].label}</Badge></Group>
    {photo ? <CleaningPhotoPreview submissionId={submission.id} photoId={photo.id} label={slot.label} /> : <Text c="dimmed">No photo has been submitted for this item.</Text>}
    {photo?.rejectionReason ? <Text size="sm" c="red">Retake reason: {photo.rejectionReason}</Text> : null}
    {photo?.reviewerName ? <Text size="xs" c="dimmed">Reviewed by {photo.reviewerName}</Text> : null}
    {error ? <Alert color="red">{error}</Alert> : null}
    {slot.status === "pending" && submission.canReview ? <>
      <Textarea label={`Retake reason for ${slot.label}`} placeholder="Explain what needs to be cleaned or shown more clearly" value={reason} onChange={(event) => setReason(event.currentTarget.value)} minRows={2} autosize maxLength={2000} disabled={busy} />
      <Group grow><Button color="red" variant="light" onClick={() => void decide("rejected")} loading={review.isPending} disabled={busy}>Request retake</Button><Button color="teal" onClick={() => void decide("approved")} loading={review.isPending} disabled={busy}>Approve photo</Button></Group>
    </> : null}
  </Stack></Paper>;
};

const CleaningReviewAction = ({ submissionId }: { submissionId: number }) => {
  const actorId = useAppSelector((state) => state.session.loggedUserId);
  const query = useCleaningSubmission(submissionId, actorId);
  const cachedDataBlocked = useCleaningCachedDataBlocked(query.error, query.isSuccess);
  const [message, setMessage] = useState<string | null>(null);
  const [escalationReason, setEscalationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const acquire = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const release = () => { busyRef.current = false; setBusy(false); };
  if (query.isLoading && !query.data) return <Center py="xl"><Loader /></Center>;
  if (cachedDataBlocked || (query.error && !query.data)) return <Alert color="red">{getCleaningError(query.error)} <Button size="xs" variant="subtle" onClick={() => void query.refetch()} disabled={query.isFetching} loading={query.isFetching}>Refresh review</Button></Alert>;
  const submission = query.data;
  if (!submission) return <Alert color="yellow">This cleaning review is no longer available.</Alert>;
  return <Stack gap="md">
    {query.error ? <Alert color="yellow" title="Review refresh interrupted">
      <Stack gap="xs">
        <Text size="sm">{getCleaningError(query.error, "Unable to refresh this review right now.")} Showing saved details; your review notes are kept.</Text>
        <Button size="xs" variant="subtle" onClick={() => void query.refetch()} disabled={query.isFetching} loading={query.isFetching}>Refresh review</Button>
      </Stack>
    </Alert> : null}
    <Text fw={700}>{submission.subjectName || "Assigned staff member"} · {submission.title}</Text>
    <Text size="sm" c="dimmed">{submission.taskDate} · {submission.shiftName}</Text>
    <Text size="sm">Check each required photo. The task completes automatically only after all photos are approved.</Text>
    {submission.reviewerMissing && submission.canReview ? <>
      <Alert color="yellow">No on-shift reviewer is available. Record why you are reviewing this as management.</Alert>
      <Textarea required label="Management review reason" value={escalationReason} onChange={(event) => setEscalationReason(event.currentTarget.value)} maxLength={2000} disabled={busy} autosize minRows={2} />
    </> : null}
    {!submission.canReview ? <Alert color="yellow">You cannot review this submission. An eligible manager must handle it.</Alert> : null}
    {message ? <Alert color="teal">{message}</Alert> : null}
    {submission.slots.map((slot) => <ReviewPhoto key={`${slot.key}-${slot.currentVersion?.id ?? "missing"}`} slot={slot} submission={submission} onMessage={setMessage} escalationReason={escalationReason} busy={busy} acquire={acquire} release={release} />)}
  </Stack>;
};

export default CleaningReviewAction;
