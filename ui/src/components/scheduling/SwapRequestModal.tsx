import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Select, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import type { ShiftAssignment, ShiftInstance } from "../../types/scheduling";

export interface SwapRequestModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => Promise<void>;
  fromAssignment: ShiftAssignment | null;
  fromShift: ShiftInstance | null;
  potentialAssignments: Array<ShiftAssignment & { shiftInstance?: ShiftInstance }>;
}

const SwapRequestModal = ({
  opened,
  onClose,
  onSubmit,
  fromAssignment,
  fromShift,
  potentialAssignments,
}: SwapRequestModalProps) => {
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
        const teammateName = assignment.assignee
          ? `${assignment.assignee.firstName} ${assignment.assignee.lastName}`
          : "Unassigned";
        const shiftTypeName = assignment.shiftInstance?.shiftType?.name ?? "Shift";
        const timeRange = assignment.shiftInstance
          ? `${assignment.shiftInstance.timeStart}${
              assignment.shiftInstance.timeEnd ? ` - ${assignment.shiftInstance.timeEnd}` : ""
            }`
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

  return (
    <Modal opened={opened} onClose={onClose} title="Request swap" size="md">
      <Stack>
        <Select
          label="Shift date"
          placeholder="Select date"
          data={dateOptions}
          value={selectedDate}
          onChange={handleDateChange}
          disabled={dateOptions.length === 0}
          required
        />
        <Select
          label="Swap with"
          placeholder={selectedDate ? "Select team member" : "Choose a date first"}
          data={partnerOptions}
          value={targetAssignmentId}
          onChange={setTargetAssignmentId}
          disabled={disablePartnerSelect}
          required
        />
        {selectedDate && partnerOptions.length === 0 ? (
          <Text size="sm" c="dimmed">
            No teammates available with matching shift type and role on this date.
          </Text>
        ) : null}
        <Button onClick={handleSubmit} loading={submitting} disabled={!selectedAssignment || submitting}>
          Send request
        </Button>
      </Stack>
    </Modal>
  );
};

export default SwapRequestModal;
