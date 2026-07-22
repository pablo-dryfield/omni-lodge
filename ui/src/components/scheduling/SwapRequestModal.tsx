import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconArrowsExchange, IconCalendar, IconClock, IconUserSearch, IconX } from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";

export interface SwapRequestModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => Promise<void>;
  fromAssignment: ShiftAssignment | null;
  fromShift: ShiftInstance | null;
  potentialAssignments: Array<ShiftAssignment & { shiftInstance?: ShiftInstance }>;
}

const HEADER_FONT_STACK = "'Arial Black', 'Inter', sans-serif";

const formatTime = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
};

const formatShiftTimeRange = (start?: string | null, end?: string | null) =>
  [formatTime(start), formatTime(end)].filter(Boolean).join(" - ");

const formatRoleLabel = (value?: string | null) =>
  value?.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase()) || "Role";

const getName = (assignment?: ShiftAssignment | null, fallback = "Teammate") => {
  const user = assignment?.assignee;
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || fallback;
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts[1]?.[0] ?? ""}`.toUpperCase();
};

const getPhotoUrl = (assignment?: ShiftAssignment | null) =>
  buildUserProfilePhotoUrl({ user: assignment?.assignee ?? null });

const SwapRequestModal = ({
  opened,
  onClose,
  onSubmit,
  fromAssignment,
  fromShift,
  potentialAssignments,
}: SwapRequestModalProps) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [targetAssignmentId, setTargetAssignmentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dateOptions = useMemo(() => {
    const uniqueDates = new Map<string, string>();
    potentialAssignments.forEach((assignment) => {
      const date = assignment.shiftInstance?.date;
      if (!date) {
        return;
      }
      if (!uniqueDates.has(date)) {
        uniqueDates.set(date, dayjs(date).format("dddd, MMM D"));
      }
    });
    return Array.from(uniqueDates.entries()).map(([value, label]) => ({ value, label }));
  }, [potentialAssignments]);

  const assignmentsForDate = useMemo(() => {
    if (!selectedDate) {
      return [];
    }
    return potentialAssignments.filter(
      (assignment) =>
        assignment.shiftInstance?.date === selectedDate &&
        assignment.assignee &&
        assignment.userId !== fromAssignment?.userId,
    );
  }, [potentialAssignments, selectedDate, fromAssignment?.userId]);

  const partnerOptions = useMemo(
    () =>
      assignmentsForDate.map((assignment) => {
        const teammateName = getName(assignment);
        const shiftTypeName = assignment.shiftInstance?.shiftType?.name ?? "Shift";
        const timeRange = assignment.shiftInstance
          ? formatShiftTimeRange(assignment.shiftInstance.timeStart, assignment.shiftInstance.timeEnd)
          : "";
        return {
          value: assignment.id.toString(),
          label: `${teammateName} - ${shiftTypeName}${timeRange ? ` - ${timeRange}` : ""}`,
        };
      }),
    [assignmentsForDate],
  );

  const selectedAssignment = useMemo(
    () => assignmentsForDate.find((assignment) => assignment.id.toString() === targetAssignmentId) ?? null,
    [assignmentsForDate, targetAssignmentId],
  );

  useEffect(() => {
    if (!opened) {
      setSelectedDate(null);
      setTargetAssignmentId(null);
      setSubmitting(false);
      return;
    }
    const preferredDate = fromShift?.date ?? null;
    const validDefault =
      preferredDate && dateOptions.some((option) => option.value === preferredDate) ? preferredDate : null;
    setSelectedDate(validDefault);
    setTargetAssignmentId(null);
  }, [opened, fromShift?.date, dateOptions]);

  const handleDateChange = (value: string | null) => {
    setSelectedDate(value);
    setTargetAssignmentId(null);
  };

  const handleSubmit = async () => {
    if (!fromAssignment || !selectedAssignment || !selectedAssignment.userId) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        fromAssignmentId: fromAssignment.id,
        toAssignmentId: selectedAssignment.id,
        partnerId: selectedAssignment.userId,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const disablePartnerSelect = !selectedDate || partnerOptions.length === 0;

  const renderAssignmentCard = (
    label: string,
    assignment: ShiftAssignment | null,
    shift: ShiftInstance | null | undefined,
    tone: "offer" | "request",
  ) => {
    const accent = tone === "offer" ? "#2563EB" : "#e90183";
    const borderColor = tone === "offer" ? "#93C5FD" : "#F9A8D4";
    const background =
      tone === "offer"
        ? "linear-gradient(180deg, rgba(239, 246, 255, 0.98), rgba(255, 255, 255, 0.98))"
        : "linear-gradient(180deg, rgba(253, 242, 248, 0.98), rgba(255, 255, 255, 0.98))";
    const name = tone === "offer" ? "You" : getName(assignment);
    const photoUrl = tone === "offer" ? null : getPhotoUrl(assignment);
    const shiftName = shift?.shiftType?.name ?? "Shift";
    const timeRange = formatShiftTimeRange(shift?.timeStart, shift?.timeEnd);

    return (
      <Paper withBorder radius={20} p={0} style={{ overflow: "hidden", border: `2px solid ${borderColor}`, background }}>
        <Center
          style={{
            minHeight: 38,
            background:
              tone === "offer"
                ? "linear-gradient(135deg, rgba(37, 99, 235, 0.16), rgba(147, 197, 253, 0.18))"
                : "linear-gradient(135deg, rgba(233, 1, 131, 0.16), rgba(244, 114, 182, 0.16))",
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <Text
            fw={900}
            style={{
              fontFamily: HEADER_FONT_STACK,
              color: accent,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontSize: 13,
            }}
          >
            {label}
          </Text>
        </Center>
        <Stack gap={9} align="center" p="md">
          <Group gap="sm" justify="center" wrap="nowrap" style={{ width: "100%" }}>
            <Avatar
              src={photoUrl ?? undefined}
              alt={name}
              size={52}
              radius="xl"
              styles={{
                root: {
                  border: "2px solid #FFFFFF",
                  outline: `2px solid ${accent}`,
                  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14)",
                  fontFamily: HEADER_FONT_STACK,
                  fontWeight: 900,
                  color: accent,
                },
              }}
            >
              {getInitials(name)}
            </Avatar>
            <Stack gap={2} align="center" style={{ minWidth: 0 }}>
              <Text fw={900} ta="center" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1.1 }}>
                {name}
              </Text>
              <Badge variant="light" color={tone === "offer" ? "blue" : "violet"} radius="xl" size="sm">
                {formatRoleLabel(assignment?.roleInShift)}
              </Badge>
            </Stack>
          </Group>

          <Text
            fw={900}
            ta="center"
            style={{
              fontFamily: HEADER_FONT_STACK,
              color: accent,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            {shiftName}
          </Text>

          <SimpleGrid cols={2} spacing="xs" style={{ width: "100%" }}>
            <Paper withBorder radius={14} p="sm" style={{ textAlign: "center", backgroundColor: "#FFFFFF" }}>
              <IconCalendar size={16} />
              <Text size="xs" fw={900} c="dimmed" tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
                Date
              </Text>
              <Text fw={900} style={{ fontFamily: HEADER_FONT_STACK }}>
                {shift?.date ? dayjs(shift.date).format("ddd, MMM D") : "Pick"}
              </Text>
            </Paper>
            <Paper withBorder radius={14} p="sm" style={{ textAlign: "center", backgroundColor: "#FFFFFF" }}>
              <IconClock size={16} />
              <Text size="xs" fw={900} c="dimmed" tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
                Time
              </Text>
              <Text fw={900} style={{ fontFamily: HEADER_FONT_STACK }}>
                {timeRange || "Pick"}
              </Text>
            </Paper>
          </SimpleGrid>
        </Stack>
      </Paper>
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={null}
      withCloseButton={false}
      fullScreen={isMobile}
      centered
      radius={isMobile ? 0 : "lg"}
      size="lg"
      styles={{
        body: {
          padding: isMobile ? "12px" : undefined,
        },
      }}
    >
      <Stack gap="md" align="center">
        <Title
          order={2}
          ta="center"
          style={{
            fontFamily: HEADER_FONT_STACK,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          Swap request
        </Title>

        <Stack gap="sm" style={{ width: "100%" }}>
          <Select
            label="Choose date"
            placeholder="Select date"
            data={dateOptions}
            value={selectedDate}
            onChange={handleDateChange}
            disabled={dateOptions.length === 0}
            leftSection={<IconCalendar size={16} />}
            required
            styles={{
              label: { width: "100%", textAlign: "center", fontWeight: 900, fontFamily: HEADER_FONT_STACK },
              input: { textAlign: "center", minHeight: 46, borderRadius: 14, fontWeight: 800 },
              option: { justifyContent: "center", textAlign: "center", fontWeight: 700 },
            }}
          />
          <Select
            label="Choose teammate"
            placeholder={selectedDate ? "Select team member" : "Choose a date first"}
            data={partnerOptions}
            value={targetAssignmentId}
            onChange={setTargetAssignmentId}
            disabled={disablePartnerSelect}
            leftSection={<IconUserSearch size={16} />}
            required
            styles={{
              label: { width: "100%", textAlign: "center", fontWeight: 900, fontFamily: HEADER_FONT_STACK },
              input: { textAlign: "center", minHeight: 46, borderRadius: 14, fontWeight: 800 },
              option: { justifyContent: "center", textAlign: "center", fontWeight: 700 },
            }}
          />
        </Stack>

        {selectedDate && partnerOptions.length === 0 ? (
          <Alert color="blue" radius="md" variant="light" w="100%">
            <Text size="sm" fw={800} ta="center">
              No teammates available with matching shift type and role on this date.
            </Text>
          </Alert>
        ) : null}

        <Box style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          {renderAssignmentCard("You offer", fromAssignment, fromShift, "offer")}
          <Center>
            <Box
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#111827",
                color: "#FFFFFF",
                boxShadow: "0 12px 22px rgba(15, 23, 42, 0.18)",
              }}
            >
              <IconArrowsExchange size={20} />
            </Box>
          </Center>
          {renderAssignmentCard("You request", selectedAssignment, selectedAssignment?.shiftInstance, "request")}
        </Box>

        <Alert color="blue" radius="md" variant="light" w="100%">
          <Text size="sm" fw={900} ta="center" style={{ fontFamily: HEADER_FONT_STACK }}>
            This only sends a request. Nothing changes until both teammate and manager approvals are complete.
          </Text>
        </Alert>

        <Group justify="space-between" w="100%" grow={isMobile}>
          <Button color="red" size="md" radius="md" leftSection={<IconX size={16} />} onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="md"
            radius="md"
            leftSection={<IconArrowsExchange size={16} />}
            onClick={handleSubmit}
            loading={submitting}
            disabled={!selectedAssignment || submitting}
          >
            Send request
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default SwapRequestModal;
