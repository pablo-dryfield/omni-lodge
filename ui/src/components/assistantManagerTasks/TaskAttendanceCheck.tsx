import { useState } from 'react';
import { Alert, Badge, Button, Group, Loader, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { IconCheck, IconRefresh } from '@tabler/icons-react';
import { attendanceCheckError, useAttendanceCheck, useSaveAttendanceCheck } from '../../api/volunteerAttendanceChecks';
import type { AttendanceCheck, AttendanceCheckAssignment, AttendanceCheckStatus } from '../../api/volunteerAttendanceChecks';
import { useModuleAccess } from '../../hooks/useModuleAccess';

const statuses = [{ value: 'on_time', label: 'On time' }, { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' }, { value: 'excused', label: 'Excused' }];

function AttendanceRow({ assignment, check, canUpdate }: { assignment: AttendanceCheckAssignment; check: AttendanceCheck; canUpdate: boolean }) {
  const options = check.evidence.filter((item) => item.subjectUserId == null || item.subjectUserId === assignment.userId)
    .map((item) => ({ value: item.id, label: item.fileName }));
  const [status, setStatus] = useState<AttendanceCheckStatus | null>(assignment.status);
  const [photoId, setPhotoId] = useState<string | null>(options.some((item) => item.value === assignment.evidenceFileId)
    ? assignment.evidenceFileId : options.length === 1 ? options[0].value : null);
  const [notes, setNotes] = useState(assignment.notes ?? '');
  const [minutes, setMinutes] = useState<number | string>(assignment.lateMinutes ?? '');
  const save = useSaveAttendanceCheck(check.taskLogId);
  const disabled = !canUpdate || assignment.self || save.isPending;
  const linked = assignment.evidenceTaskLogId === check.taskLogId && assignment.evidenceFileId != null;
  return <Paper withBorder p="sm" radius="md">
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap">
        <div><Text fw={600}>{assignment.name}</Text><Text size="xs" c="dimmed">{assignment.shiftName} · {assignment.role}</Text></div>
        {linked && <Badge color={assignment.status === 'on_time' ? 'green' : assignment.status === 'late' ? 'orange' : 'gray'}>Saved</Badge>}
      </Group>
      {assignment.self && <Text size="sm" c="dimmed">Another manager must confirm your attendance.</Text>}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Select label={`Attendance — ${assignment.name}`} data={statuses} value={status} onChange={(value) => setStatus(value as AttendanceCheckStatus | null)} disabled={disabled} allowDeselect={false} />
        <Select label={`Evidence photo — ${assignment.name}`} placeholder="Upload the task photo first" data={options} value={photoId} onChange={setPhotoId} disabled={disabled || !options.length} allowDeselect={false} />
      </SimpleGrid>
      {status === 'late' && <NumberInput label="Minutes late (optional)" value={minutes} onChange={setMinutes} min={1} max={1440} allowDecimal={false} disabled={disabled} />}
      <Textarea label={status === 'absent' || status === 'excused' ? 'Reason (required)' : 'Notes (optional)'} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} maxLength={2000} autosize minRows={1} disabled={disabled} />
      {save.error && <Alert color="red">{attendanceCheckError(save.error)}</Alert>}
      <Button size="sm" leftSection={<IconCheck size={16} />} disabled={disabled || !status || !photoId || ((status === 'absent' || status === 'excused') && !notes.trim())} loading={save.isPending}
        onClick={() => { if (status && photoId) save.mutate({ assignmentId: assignment.assignmentId, input: {
          status, evidenceFileId: photoId, expectedRevision: assignment.revision, notes: notes.trim() || null,
          lateMinutes: status === 'late' && typeof minutes === 'number' ? minutes : null,
        } }); }}>Save attendance</Button>
    </Stack>
  </Paper>;
}

export default function TaskAttendanceCheck({ taskLogId, evidenceVersion }: { taskLogId: number; evidenceVersion: string }) {
  const access = useModuleAccess('volunteer-progress');
  const query = useAttendanceCheck(taskLogId, evidenceVersion, access.ready && access.canView);
  const check = access.ready && access.canView ? query.data : undefined;
  return <Paper withBorder p="md" radius="lg">
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap"><Text fw={600}>Attendance & punctuality</Text>
        <Button variant="subtle" size="compact-sm" leftSection={<IconRefresh size={14} />} disabled={!access.ready || !access.canView} onClick={() => void query.refetch()} loading={query.isFetching}>Refresh</Button>
      </Group>
      {access.ready && !access.canView && <Alert color="yellow">Attendance access is required to view this check. Ask a manager to review it.</Alert>}
      {query.isLoading && access.canView && <Loader size="sm" />}
      {query.error && <Alert color="red">{attendanceCheckError(query.error)}</Alert>}
      {check && <>
        <Text size="sm" c="dimmed">{check.checkKind === 'meeting_point' ? 'Meeting point' : 'Promotion chat'} · {check.expectedTime} Warsaw time. Confirm each person against the task photo below.</Text>
        {!check.evidence.length && <Alert color="blue">Upload the required task photo below before recording attendance.</Alert>}
        {!check.assignments.length && <Text size="sm" c="dimmed">No staff are assigned to these shift types in the published schedule for this day.</Text>}
        {check.assignments.map((assignment) => <AttendanceRow key={`${assignment.assignmentId}:${assignment.revision}:${check.evidence.map((item) => item.id).join(',')}`} assignment={assignment} check={check} canUpdate={access.canUpdate} />)}
      </>}
    </Stack>
  </Paper>;
}
