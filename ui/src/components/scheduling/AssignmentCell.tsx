import { ActionIcon, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { ShiftAssignment } from "../../types/scheduling";

export interface AssignmentCellProps {
  assignments: ShiftAssignment[];
  onRemove?: (assignment: ShiftAssignment) => void;
  onSwap?: (assignment: ShiftAssignment) => void;
  canManage?: boolean;
}

const ROLE_PRIORITY: Record<string, number> = {
  manager: 0,
  leader: 1,
  guide: 2,
  "social media": 3,
};

const normalizeRoleName = (roleName: string | null | undefined): string => roleName?.trim().toLowerCase() ?? "";

const getRolePriority = (roleName: string, fallbackIndex: number): number =>
  (ROLE_PRIORITY[normalizeRoleName(roleName)] ?? 10) + fallbackIndex / 1000;

const resolveRoleLabel = (assignment: ShiftAssignment): string =>
  assignment.roleInShift?.trim() ||
  assignment.shiftRole?.name?.trim() ||
  `Role #${assignment.shiftRoleId ?? assignment.id}`;

const AssignmentCell = ({ assignments, onRemove, onSwap, canManage = false }: AssignmentCellProps) => {
  if (assignments.length === 0) {
    return null;
  }

  const sortedAssignments = assignments
    .map((assignment, index) => ({ assignment, index }))
    .sort(
      (a, b) =>
        getRolePriority(resolveRoleLabel(a.assignment), a.index) -
        getRolePriority(resolveRoleLabel(b.assignment), b.index),
    )
    .map((item) => item.assignment);

  const primary = sortedAssignments[0];
  const name = primary.assignee
    ? `${primary.assignee.firstName ?? ""} ${primary.assignee.lastName ?? ""}`.trim() ||
      `User #${primary.assignee.id}`
    : primary.userId != null
      ? `User #${primary.userId}`
      : "Unassigned";

  return (
    <Stack gap={6} p="xs" style={{ border: "1px solid #e6e8ec", borderRadius: 8 }}>
      <Group justify="space-between">
        <Text fw={600}>{name}</Text>
        {canManage && onSwap ? (
          <Button variant="light" size="xs" onClick={() => onSwap(primary)}>
            Swap
          </Button>
        ) : null}
      </Group>
      <Group gap="xs">
        {sortedAssignments.map((assignment) => {
          const label = resolveRoleLabel(assignment);
          return (
            <Badge
              key={assignment.id}
              color="blue"
              variant="light"
              rightSection={
                canManage && onRemove ? (
                  <ActionIcon
                    size="xs"
                    variant="transparent"
                    color="red"
                    onClick={() => onRemove(assignment)}
                    aria-label={`Remove ${label}`}
                  >
                    <IconX size={12} />
                  </ActionIcon>
                ) : undefined
              }
            >
              {label}
            </Badge>
          );
        })}
      </Group>
    </Stack>
  );
};

export default AssignmentCell;
