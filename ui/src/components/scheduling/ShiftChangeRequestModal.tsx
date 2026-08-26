import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowRight,
  IconCalendar,
  IconClock,
  IconUserMinus,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";

type AssignmentWithShift = ShiftAssignment & { shiftInstance?: ShiftInstance | null };

export interface ShiftChangeRequestModalProps {
  opened: boolean;
  requestType: "takeover" | "drop";
  assignments: AssignmentWithShift[];
  onClose: () => void;
  onSubmit: (payload: { assignmentId: number; note?: string }) => Promise<void>;
}

const HEADER_FONT_STACK = "'Arial Black', 'Inter', sans-serif";
const NOTE_LIMIT = 2000;

const formatTime = (value?: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
};

const formatTimeRange = (shift?: ShiftInstance | null) =>
  [formatTime(shift?.timeStart), formatTime(shift?.timeEnd)].filter(Boolean).join(" - ") || "Any time";

const getName = (assignment?: AssignmentWithShift | null) => {
  const firstName = assignment?.assignee?.firstName?.trim() ?? "";
  const lastName = assignment?.assignee?.lastName?.trim() ?? "";
  return `${firstName} ${lastName}`.trim() || "Teammate";
};

const getInitials = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts[1]?.[0] ?? ""}`.toUpperCase();
};

const getErrorMessage = (error: unknown) => {
  const responseMessage = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  if (typeof responseMessage?.error === "string") return responseMessage.error;
  if (typeof responseMessage?.message === "string") return responseMessage.message;
  return error instanceof Error ? error.message : "Could not create this shift request.";
};

const ShiftChangeRequestModal = ({
  opened,
  requestType,
  assignments,
  onClose,
  onSubmit,
}: ShiftChangeRequestModalProps) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultAssignmentId = assignments.length === 1 ? String(assignments[0].id) : null;

  useEffect(() => {
    if (!opened) {
      setSelectedAssignmentId(null);
      setNote("");
      setSubmitting(false);
      setError(null);
      return;
    }
    setSelectedAssignmentId(defaultAssignmentId);
    setNote("");
    setError(null);
  }, [defaultAssignmentId, opened]);

  const selectedAssignment = useMemo(
    () => assignments.find((assignment) => String(assignment.id) === selectedAssignmentId) ?? null,
    [assignments, selectedAssignmentId],
  );

  const assignmentOptions = useMemo(
    () =>
      assignments.map((assignment) => ({
        value: String(assignment.id),
        label: `${assignment.shiftInstance?.shiftType?.name ?? "Shift"} | ${assignment.roleInShift || "Role"} | ${
          assignment.shiftInstance?.date ? dayjs(assignment.shiftInstance.date).format("ddd, MMM D") : "Unknown date"
        } | ${formatTimeRange(assignment.shiftInstance)}`,
      })),
    [assignments],
  );

  const handleClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async () => {
    if (!selectedAssignment) return;
    setSubmitting(true);
    setError(null);
    try {
      const normalizedNote = note.trim();
      await onSubmit({ assignmentId: selectedAssignment.id, ...(normalizedNote ? { note: normalizedNote } : {}) });
      onClose();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const ownerName = getName(selectedAssignment ?? assignments[0]);
  const shift = selectedAssignment?.shiftInstance ?? null;
  const isTakeover = requestType === "takeover";
  const accent = isTakeover ? "teal" : "orange";

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={null}
      withCloseButton={false}
      centered
      fullScreen={isMobile}
      radius={isMobile ? 0 : "lg"}
      size="lg"
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      styles={{ body: { padding: isMobile ? "16px" : undefined } }}
    >
      <Stack gap="md" mih={isMobile ? "calc(100dvh - 32px)" : undefined}>
        <Stack gap={5} align="center">
          <Title order={2} ta="center" style={{ fontFamily: HEADER_FONT_STACK, textTransform: "uppercase" }}>
            {isTakeover ? "Take over shift" : "Drop shift"}
          </Title>
          <Text c="dimmed" ta="center" fw={700}>
            {isTakeover
              ? `Ask ${ownerName} to hand this shift over to you.`
              : "Ask a manager to remove this shift from your schedule."}
          </Text>
        </Stack>

        {assignments.length > 1 ? (
          <Select
            label="Choose the exact shift"
            placeholder="Select a role and time"
            data={assignmentOptions}
            value={selectedAssignmentId}
            onChange={setSelectedAssignmentId}
            allowDeselect={false}
            required
            styles={{ label: { fontWeight: 800 }, input: { minHeight: 46, borderRadius: 14 } }}
          />
        ) : null}

        <Paper withBorder radius={18} p="md" style={{ borderColor: isTakeover ? "#5EEAD4" : "#FDBA74" }}>
          <Stack gap="sm" align="center">
            <Group gap="sm" wrap="nowrap">
              <Avatar
                src={buildUserProfilePhotoUrl({ user: selectedAssignment?.assignee ?? assignments[0]?.assignee ?? null }) ?? undefined}
                alt={ownerName}
                radius="xl"
                size={52}
              >
                {getInitials(ownerName)}
              </Avatar>
              <Stack gap={2}>
                <Text fw={900}>{ownerName}</Text>
                <Badge color={accent} variant="light" radius="xl">
                  {selectedAssignment?.roleInShift || "Shift"}
                </Badge>
              </Stack>
            </Group>

            <Text fw={900} size="xl" ta="center" c={isTakeover ? "teal.8" : "orange.9"}>
              {shift?.shiftType?.name ?? "Select a shift"}
            </Text>
            <Group grow w="100%">
              <Box ta="center">
                <IconCalendar size={18} aria-hidden="true" />
                <Text size="xs" c="dimmed" fw={800} tt="uppercase">Date</Text>
                <Text fw={800}>{shift?.date ? dayjs(shift.date).format("ddd, MMM D") : "--"}</Text>
              </Box>
              <Box ta="center">
                <IconClock size={18} aria-hidden="true" />
                <Text size="xs" c="dimmed" fw={800} tt="uppercase">Time</Text>
                <Text fw={800}>{shift ? formatTimeRange(shift) : "--"}</Text>
              </Box>
            </Group>
          </Stack>
        </Paper>

        {isTakeover ? (
          <Group justify="center" gap="xs">
            <Text fw={800}>{ownerName}</Text>
            <IconArrowRight size={20} aria-hidden="true" />
            <Text fw={900} c="teal.8">You</Text>
          </Group>
        ) : null}

        <Textarea
          label="Notes (optional)"
          description={isTakeover ? "Explain why you can cover this shift." : "Explain why you cannot work this shift."}
          placeholder="Add context for the approvers"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={7}
          maxLength={NOTE_LIMIT}
          disabled={submitting}
          styles={{ label: { fontWeight: 800 }, input: { borderRadius: 14 } }}
        />
        <Text size="xs" c="dimmed" ta="right">{note.length}/{NOTE_LIMIT}</Text>

        <Alert color={isTakeover ? "teal" : "orange"} radius="md" variant="light">
          <Text size="sm" fw={800} ta="center">
            {isTakeover
              ? "Nothing changes until the current assignee accepts and a manager approves."
              : "You remain assigned until a manager approves. Approval will leave this role unfilled."}
          </Text>
        </Alert>

        {error ? <Alert color="red" role="alert">{error}</Alert> : null}

        <Group grow mt={isMobile ? "auto" : undefined}>
          <Button color="red" variant="light" leftSection={<IconX size={18} />} onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color={accent}
            leftSection={isTakeover ? <IconUserPlus size={18} /> : <IconUserMinus size={18} />}
            onClick={handleSubmit}
            loading={submitting}
            disabled={!selectedAssignment}
          >
            Send request
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default ShiftChangeRequestModal;
