import { useMemo, useState } from "react";
import { Badge, Button, Card, Group, Select, Stack, Text, Title } from "@mantine/core";
import dayjs from "dayjs";
import { useManagerSwapDecision, useSwaps } from "../../api/scheduling";
import type { ShiftAssignment } from "../../types/scheduling";

const STATUS_OPTIONS = [
  { value: "pending_partner", label: "AWAITING TEAMMATE" },
  { value: "pending_manager", label: "AWAITING MANAGER" },
  { value: "approved", label: "APPROVED" },
  { value: "denied", label: "DENIED" },
  { value: "canceled", label: "CANCELED" },
];

const formatUserName = (
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallbackId: number,
) => {
  if (user?.firstName || user?.lastName) {
    return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  }
  return `User #${fallbackId}`;
};

const describeShift = (assignment: ShiftAssignment | null | undefined, ownerLabel: string) => {
  if (!assignment || !assignment.shiftInstance) {
    return `${ownerLabel} shift: details unavailable.`;
  }
  const { shiftInstance } = assignment;
  const dateLabel = shiftInstance.date ? dayjs(shiftInstance.date).format("ddd, MMM D") : "Unknown date";
  const timeStart = shiftInstance.timeStart ?? "?";
  const timeEnd = shiftInstance.timeEnd ? ` - ${shiftInstance.timeEnd}` : "";
  const shiftTypeName = shiftInstance.shiftType?.name ?? "Shift";
  const role = assignment.roleInShift || "Role not specified";
  return `${ownerLabel} shift: ${dateLabel} - ${shiftTypeName} - ${timeStart}${timeEnd} - ${role}`;
};

const SwapsPage = () => {
  const [status, setStatus] = useState("pending_manager");
  const swapsQuery = useSwaps(status);
  const managerDecision = useManagerSwapDecision();
  const [decisionSwapId, setDecisionSwapId] = useState<number | null>(null);

  const statusLabelMap = useMemo(
    () => new Map<string, string>(STATUS_OPTIONS.map((option) => [option.value, option.label])),
    [],
  );

  const handleDecision = async (swapId: number, approve: boolean) => {
    setDecisionSwapId(swapId);
    try {
      await managerDecision.mutateAsync({ swapId, approve });
    } finally {
      setDecisionSwapId(null);
    }
  };

  const swaps = swapsQuery.data ?? [];

  return (
    <Stack mt="lg" gap="lg">
      <Group justify="space-between" align="flex-end">
        <Title order={3}>Swap requests</Title>
        <Select
          data={STATUS_OPTIONS}
          value={status}
          label="Status"
          onChange={(value) => {
            if (value) {
              setStatus(value);
            }
          }}
        />
      </Group>

      <Stack gap="md">
        {swaps.length === 0 ? (
          <Text size="sm" c="dimmed">
            No swap requests in this state.
          </Text>
        ) : (
          swaps.map((swap) => (
            <Card key={swap.id} withBorder radius="md">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={2}>
                    <Text fw={600}>Request #{swap.id}</Text>
                    <Text size="xs" c="dimmed">
                      {`Requested ${formatUserName(swap.requester ?? null, swap.requesterId)}${
                        swap.createdAt ? ` on ${dayjs(swap.createdAt).format("MMM D, YYYY HH:mm")}` : ""
                      }`}
                    </Text>
                  </Stack>
                  <Badge>{statusLabelMap.get(swap.status) ?? swap.status.toUpperCase()}</Badge>
                </Group>
                <Stack gap={4}>
                  <Text size="sm">{describeShift(swap.fromAssignment ?? null, `${swap.requester?.firstName ?? "Teammate"} ${swap.requester?.lastName ?? ""}`)}</Text>
                  <Text size="sm">{describeShift(swap.toAssignment ?? null, `${swap.partner?.firstName ?? "Teammate"} ${swap.partner?.lastName ?? ""}`)}</Text>
                </Stack>
                {swap.decisionReason ? (
                  <Text size="xs" c="dimmed">
                    Manager note: {swap.decisionReason}
                  </Text>
                ) : null}
                {status === "pending_manager" && (
                  <Group>
                    <Button
                      size="xs"
                      color="green"
                      loading={decisionSwapId === swap.id && managerDecision.isPending}
                      onClick={() => handleDecision(swap.id, true)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      loading={decisionSwapId === swap.id && managerDecision.isPending}
                      onClick={() => handleDecision(swap.id, false)}
                    >
                      Deny
                    </Button>
                  </Group>
                )}
              </Stack>
            </Card>
          ))
        )}
      </Stack>
    </Stack>
  );
};

export default SwapsPage;
