import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Table,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconArrowBackUp, IconCheck, IconEye, IconX } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  approveFinanceManagementRequest,
  fetchFinanceManagementRequests,
  rejectFinanceManagementRequest,
  returnFinanceManagementRequest,
} from "../../actions/financeActions";
import { selectFinanceManagementRequests } from "../../selectors/financeSelectors";
import { FinanceManagementRequest } from "../../types/finance";

const FinanceManagementRequests = () => {
  const dispatch = useAppDispatch();
  const managementRequests = useAppSelector(selectFinanceManagementRequests);

  const [selectedRequest, setSelectedRequest] = useState<FinanceManagementRequest | null>(null);
  const [decisionNote, setDecisionNote] = useState<string>("");

  useEffect(() => {
    dispatch(fetchFinanceManagementRequests());
  }, [dispatch]);

  const groupedRequests = useMemo(() => {
    const priorities = { high: 0, normal: 1, low: 2 } as const;
    return [...managementRequests.data].sort((a, b) => {
      if (a.status === b.status) {
        return priorities[a.priority] - priorities[b.priority];
      }
      return a.status.localeCompare(b.status);
    });
  }, [managementRequests.data]);

  const handleDecision = async (
    action: "approve" | "return" | "reject",
    request: FinanceManagementRequest,
  ) => {
    if (action === "approve") {
      await dispatch(approveFinanceManagementRequest({ id: request.id, decisionNote }));
    } else if (action === "return") {
      await dispatch(returnFinanceManagementRequest({ id: request.id, decisionNote }));
    } else {
      await dispatch(rejectFinanceManagementRequest({ id: request.id, decisionNote }));
    }
    setDecisionNote("");
    setSelectedRequest(null);
    await dispatch(fetchFinanceManagementRequests());
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Management Requests</Title>
        <Badge color="blue" variant="light">
          {managementRequests.data.filter((request) => request.status === "open" || request.status === "returned").length} open
        </Badge>
      </Group>

      <Card withBorder padding="0">
        <Table highlightOnHover striped verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Entity</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th>Requested</Table.Th>
              <Table.Th>Due</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groupedRequests.map((request) => (
              <Table.Tr key={request.id}>
                <Table.Td>{request.id}</Table.Td>
                <Table.Td>{request.type}</Table.Td>
                <Table.Td>
                  {request.targetEntity}
                  {request.targetId ? ` #${request.targetId}` : ""}
                </Table.Td>
                <Table.Td>
                  <Badge color={request.status === "open" ? "orange" : request.status === "approved" ? "green" : "gray"} variant="light">
                    {request.status.toUpperCase()}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge color={request.priority === "high" ? "red" : request.priority === "normal" ? "yellow" : "gray"} variant="light">
                    {request.priority.toUpperCase()}
                  </Badge>
                </Table.Td>
                <Table.Td>{dayjs(request.createdAt).format("YYYY-MM-DD HH:mm")}</Table.Td>
                <Table.Td>{request.dueAt ? dayjs(request.dueAt).format("YYYY-MM-DD") : "—"}</Table.Td>
                <Table.Td width={140}>
                  <Group gap={4} justify="flex-end">
                    <ActionIcon variant="subtle" onClick={() => setSelectedRequest(request)}>
                      <IconEye size={18} />
                    </ActionIcon>
                    {(request.status === "open" || request.status === "returned") && (
                      <>
                        <ActionIcon
                          variant="subtle"
                          color="green"
                          onClick={() => {
                            setSelectedRequest(request);
                            setDecisionNote("");
                          }}
                          title="Approve"
                        >
                          <IconCheck size={18} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="orange"
                          onClick={() => {
                            setSelectedRequest(request);
                            setDecisionNote("");
                          }}
                          title="Return for changes"
                        >
                          <IconArrowBackUp size={18} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => {
                            setSelectedRequest(request);
                            setDecisionNote("");
                          }}
                          title="Reject"
                        >
                          <IconX size={18} />
                        </ActionIcon>
                      </>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal
        opened={Boolean(selectedRequest)}
        onClose={() => {
          setSelectedRequest(null);
          setDecisionNote("");
        }}
        title={selectedRequest ? `Request #${selectedRequest.id}` : ""}
        size="xl"
      >
        {selectedRequest && (
          <Stack gap="md">
            <Group gap="md">
              <Badge variant="light" color="blue">
                {selectedRequest.type}
              </Badge>
              <Badge variant="light">{selectedRequest.targetEntity}</Badge>
              <Badge variant="light" color={selectedRequest.status === "open" ? "orange" : "gray"}>
                {selectedRequest.status.toUpperCase()}
              </Badge>
            </Group>
            <Textarea
              label="Payload"
              minRows={10}
              value={JSON.stringify(selectedRequest.payload, null, 2)}
              readOnly
              autosize
            />
            <TextInput
              label="Decision note"
              placeholder="Optional note for the requester"
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.currentTarget.value)}
            />
            <Group justify="space-between">
              <Button variant="light" onClick={() => setSelectedRequest(null)}>
                Close
              </Button>
              <Group>
                <Button
                  color="orange"
                  variant="light"
                  onClick={() => handleDecision("return", selectedRequest)}
                >
                  Return
                </Button>
                <Button color="red" variant="light" onClick={() => handleDecision("reject", selectedRequest)}>
                  Reject
                </Button>
                <Button color="green" onClick={() => handleDecision("approve", selectedRequest)}>
                  Approve
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};

export default FinanceManagementRequests;

