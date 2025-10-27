
import { useState } from "react";
import { Button, Modal, Select, Stack } from "@mantine/core";
import type { ShiftAssignment } from "../../types/scheduling";

export interface SwapRequestModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (payload: { fromAssignmentId: number; toAssignmentId: number; partnerId: number }) => Promise<void>;
  fromAssignment: ShiftAssignment | null;
  potentialAssignments: ShiftAssignment[];
  partners: Array<{ value: string; label: string }>;
}

const SwapRequestModal = ({
  opened,
  onClose,
  onSubmit,
  fromAssignment,
  potentialAssignments,
  partners,
}: SwapRequestModalProps) => {
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [targetAssignmentId, setTargetAssignmentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!fromAssignment || !partnerId || !targetAssignmentId) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        fromAssignmentId: fromAssignment.id,
        toAssignmentId: Number(targetAssignmentId),
        partnerId: Number(partnerId),
      });
      onClose();
      setPartnerId(null);
      setTargetAssignmentId(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Request swap" size="md">
      <Stack>
        <Select
          label="Swap with"
          placeholder="Select team member"
          data={partners}
          value={partnerId}
          onChange={setPartnerId}
          required
        />
        <Select
          label="Target assignment"
          placeholder="Select assignment"
          data={potentialAssignments.map((assignment) => ({
            value: assignment.id.toString(),
            label: `${assignment.roleInShift} · ${assignment.assignee ? `${assignment.assignee.firstName} ${assignment.assignee.lastName}` : "Unassigned"}`,
          }))}
          value={targetAssignmentId}
          onChange={setTargetAssignmentId}
          required
        />
        <Button onClick={handleSubmit} loading={submitting} disabled={!partnerId || !targetAssignmentId}>
          Send request
        </Button>
      </Stack>
    </Modal>
  );
};

export default SwapRequestModal;
