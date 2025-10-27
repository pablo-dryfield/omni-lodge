import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import type { ShiftAssignment } from "../../types/scheduling";

export interface AssignmentCellProps {
  assignment: ShiftAssignment;
  onRemove?: (assignment: ShiftAssignment) => void;
  onSwap?: (assignment: ShiftAssignment) => void;
  canManage?: boolean;
}

const AssignmentCell = ({ assignment, onRemove, onSwap, canManage = false }: AssignmentCellProps) => {
  const name = assignment.assignee
    ? `${assignment.assignee.firstName} ${assignment.assignee.lastName}`
    : "Unassigned";

  return (
    <Stack gap={4} p="xs" style={{ border: "1px solid #e6e8ec", borderRadius: 8 }}>
      <Group justify="space-between">
        <Text fw={600}>{name}</Text>
        <Badge color="blue" variant="light">
          {assignment.roleInShift}
        </Badge>
      </Group>
      {canManage && (
        <Group gap="xs">
          {onSwap && (
            <Button variant="light" size="xs" onClick={() => onSwap(assignment)}>
              Swap
            </Button>
          )}
          {onRemove && (
            <Button variant="subtle" color="red" size="xs" onClick={() => onRemove(assignment)}>
              Remove
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
};

export default AssignmentCell;
