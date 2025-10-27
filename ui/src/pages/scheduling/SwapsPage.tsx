import { useState } from "react";
import { Button, Card, Group, Select, Stack, Text, Title } from "@mantine/core";
import dayjs from "dayjs";
import { useManagerSwapDecision, useSwaps } from "../../api/scheduling";

const STATUS_OPTIONS = [
  { value: "pending_partner", label: "Awaiting partner" },
  { value: "pending_manager", label: "Awaiting manager" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "canceled", label: "Canceled" },
];

const SwapsPage = () => {
  const [status, setStatus] = useState("pending_manager");
  const swapsQuery = useSwaps(status);
  const managerDecision = useManagerSwapDecision();

  const handleDecision = async (swapId: number, approve: boolean) => {
    await managerDecision.mutateAsync({ swapId, approve });
  };

  const swaps = swapsQuery.data ?? [];

  return (
    <Stack mt="lg" gap="lg">
      <Group justify="space-between" align="flex-end">
        <Title order={3}>Swap requests</Title>
        <Select data={STATUS_OPTIONS} value={status} onChange={(value) => value && setStatus(value)} label="Status" />
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
                <Group justify="space-between">
                  <Text fw={600}>Request #{swap.id}</Text>
                  <Text size="xs" c="dimmed">
                    {swap.createdAt ? Created  : null}
                  </Text>
                </Group>
                <Text size="sm">
                  From assignment {swap.fromAssignmentId} › {swap.toAssignmentId}
                </Text>
                <Text size="sm">Status: {swap.status}</Text>
                {status === "pending_manager" && (
                  <Group>
                    <Button size="xs" color="green" onClick={() => handleDecision(swap.id, true)}>
                      Approve
                    </Button>
                    <Button size="xs" color="red" variant="light" onClick={() => handleDecision(swap.id, false)}>
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
