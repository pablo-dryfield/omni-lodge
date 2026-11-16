import { Alert, Badge, Button, Group, Paper, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { getCleaningError, useResolveCleaningAttendance, type CleaningAttendanceDecision, type CleaningSubmission } from "../../api/volunteerCleaning";
import { useAppSelector } from "../../store/hooks";

const labels = { absent: "Absent", excused: "Excused", photos_required: "Require photos" };

export default function CleaningAttendanceControls({ submission, onChange }: { submission: CleaningSubmission; onChange?: () => void | Promise<void> }) {
  const userId = useAppSelector((state) => state.session.loggedUserId);
  const mutation = useResolveCleaningAttendance(userId);
  const busy = useRef(false);
  const [decision, setDecision] = useState<CleaningAttendanceDecision | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setDecision(null); setReason(""); }, [submission.id, submission.revision]);
  const resolution = submission.attendanceResolution;
  const save = async () => {
    if (!decision || !reason.trim() || busy.current || !submission.canResolveAttendance) return;
    busy.current = true; setError(null); setMessage(null);
    try {
      const result = await mutation.mutateAsync({ submissionId: submission.id, expectedRevision: submission.revision, decision, reason: reason.trim() });
      setDecision(null); setReason("");
      setMessage(result.taskCompleted ? "Saved. All cleaning assignments are resolved and the task is complete." : "Attendance saved.");
      await onChange?.();
    } catch (failure) { setError(getCleaningError(failure, "Unable to save attendance. Refresh and try again.")); }
    finally { busy.current = false; }
  };
  return <Stack gap="xs">
    {resolution ? <Alert color={resolution.status === "excused" ? "blue" : "red"} title={labels[resolution.status]}>
      <Stack gap={4} ta="center">
        <Text size="sm">{resolution.reason}</Text>
        <Text size="xs" c="dimmed">No photo required. {resolution.status === "excused" ? "Excluded from the cleaning requirement and attendance target." : "Recorded as missed attendance; no cleaning credit."}</Text>
      </Stack>
    </Alert> : <Group justify="center"><Badge variant="light" color={submission.status === "approved" ? "teal" : "gray"}>
      {submission.status === "approved" ? "Photos approved" : "Photos required"}
    </Badge></Group>}
    {submission.canResolveAttendance ? <>
      {!decision ? <Stack gap={4}><Group justify="center" grow wrap="wrap">
        <Button size="xs" color="red" variant="light" onClick={() => { setDecision("absent"); setMessage(null); }}>Absent</Button>
        <Button size="xs" variant="light" onClick={() => { setDecision("excused"); setMessage(null); }}>Excused</Button>
      </Group>
        {resolution ? <Button size="compact-sm" variant="subtle" fullWidth onClick={() => { setDecision("photos_required"); setMessage(null); }}>Require photos</Button> : null}
      </Stack> : <Paper withBorder p="sm" radius="md"><Stack gap="xs">
        <Text fw={600} size="sm" ta="center">{labels[decision]} — {submission.subjectName || `Staff #${submission.userId}`}</Text>
        <Textarea label="Reason" required maxLength={2000} autosize minRows={2} value={reason}
          disabled={mutation.isPending} onChange={(event) => setReason(event.currentTarget.value)} />
        <Text size="xs" c="dimmed" ta="center">This decision updates attendance and is recorded in the task history.</Text>
        <Group grow><Button variant="default" disabled={mutation.isPending} onClick={() => { setDecision(null); setError(null); }}>Cancel</Button>
          <Button color={decision === "absent" ? "red" : "blue"} loading={mutation.isPending} disabled={!reason.trim()} onClick={() => void save()}>Save attendance</Button></Group>
      </Stack></Paper>}
    </> : null}
    {error ? <Alert color="red">{error}</Alert> : null}
    {message ? <Alert color="teal">{message}</Alert> : null}
  </Stack>;
}
