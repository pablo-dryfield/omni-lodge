import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconArrowBackUp, IconCheck, IconEye, IconFileInvoice, IconX } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  approveFinanceManagementRequest,
  fetchFinanceManagementRequests,
  rejectFinanceManagementRequest,
  returnFinanceManagementRequest,
} from "../../actions/financeActions";
import { selectFinanceManagementRequests } from "../../selectors/financeSelectors";
import { FinanceManagementRequest } from "../../types/finance";
import {
  FinanceEmptyState,
  FinanceErrorState,
  FinanceConfirmModal,
  FinanceFormSection,
  FinanceLoadingState,
  FinanceModal,
  FinanceModalFooter,
  FinancePageHeader,
  FinancePanel,
  FinanceRecordCard,
  FinanceToolbar,
  financePageClass,
} from "../../components/finance/FinanceUi";
import {
  formatFinanceDate,
  formatFinanceMoneyMinor,
  getFinanceErrorMessage,
  humanizeFinanceValue,
} from "../../components/finance/financeFormatters";

type DecisionAction = "approve" | "return" | "reject";

const statusColor = (status: FinanceManagementRequest["status"]): string => {
  if (status === "open") {
    return "orange";
  }
  if (status === "approved") {
    return "green";
  }
  if (status === "rejected") {
    return "red";
  }
  return "blue";
};

const priorityColor = (priority: FinanceManagementRequest["priority"]): string => {
  if (priority === "high") {
    return "red";
  }
  if (priority === "normal") {
    return "yellow";
  }
  return "gray";
};

const isPrimitive = (value: unknown): value is string | number | boolean | null =>
  value == null || ["string", "number", "boolean"].includes(typeof value);

const renderPayloadValue = (
  key: string,
  value: unknown,
  payload: Record<string, unknown>,
): ReactNode => {
  if (value == null || value === "") {
    return "—";
  }
  if (key.toLowerCase().endsWith("amountminor")) {
    const amountMinor = Number(value);
    if (Number.isFinite(amountMinor)) {
      const currency = typeof payload.currency === "string" && payload.currency.trim()
        ? payload.currency.trim().toUpperCase()
        : "PLN";
      return formatFinanceMoneyMinor(amountMinor, currency);
    }
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value) && value.every(isPrimitive)) {
    return value.map((item) => String(item ?? "—")).join(", ");
  }
  if (typeof value === "object") {
    return (
      <Code block style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {JSON.stringify(value, null, 2)}
      </Code>
    );
  }
  return String(value);
};

const FinanceManagementRequests = () => {
  const dispatch = useAppDispatch();
  const managementRequests = useAppSelector(selectFinanceManagementRequests);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const [selectedRequest, setSelectedRequest] = useState<FinanceManagementRequest | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<DecisionAction | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchFinanceManagementRequests());
  }, [dispatch]);

  const groupedRequests = useMemo(() => {
    const priorities = { high: 0, normal: 1, low: 2 } as const;
    const query = search.trim().toLowerCase();
    return [...managementRequests.data]
      .filter((request) => {
        if (statusFilter && request.status !== statusFilter) {
          return false;
        }
        if (priorityFilter && request.priority !== priorityFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [
          request.id,
          request.type,
          request.targetEntity,
          request.targetId,
          request.status,
          request.priority,
          JSON.stringify(request.payload),
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const aActionable = a.status === "open" || a.status === "returned" ? 0 : 1;
        const bActionable = b.status === "open" || b.status === "returned" ? 0 : 1;
        if (aActionable !== bActionable) {
          return aActionable - bActionable;
        }
        const priorityDifference = priorities[a.priority] - priorities[b.priority];
        if (priorityDifference !== 0) {
          return priorityDifference;
        }
        const aDueOrCreated = new Date(a.dueAt ?? a.createdAt).getTime();
        const bDueOrCreated = new Date(b.dueAt ?? b.createdAt).getTime();
        if (aDueOrCreated !== bDueOrCreated) {
          return aDueOrCreated - bDueOrCreated;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [managementRequests.data, priorityFilter, search, statusFilter]);

  const openRequest = (request: FinanceManagementRequest) => {
    setSelectedRequest(request);
    setDecisionNote("");
    setDecisionError(null);
    setPendingDecision(null);
  };

  const closeRequest = () => {
    if (decisionBusy) {
      return;
    }
    setSelectedRequest(null);
    setDecisionNote("");
    setDecisionError(null);
    setPendingDecision(null);
  };

  const requestDecision = (action: DecisionAction) => {
    if ((action === "return" || action === "reject") && !decisionNote.trim()) {
      setDecisionError(`A decision note is required to ${action} this request.`);
      return;
    }
    setDecisionError(null);
    setPendingDecision(action);
  };

  const handleDecision = async (
    action: DecisionAction,
    request: FinanceManagementRequest,
  ) => {
    if ((action === "return" || action === "reject") && !decisionNote.trim()) {
      setDecisionError(`A decision note is required to ${action} this request.`);
      setPendingDecision(null);
      return;
    }
    try {
      setDecisionBusy(true);
      setDecisionError(null);
      const normalizedNote = decisionNote.trim();
      if (action === "approve") {
        await dispatch(approveFinanceManagementRequest({ id: request.id, decisionNote: normalizedNote })).unwrap();
      } else if (action === "return") {
        await dispatch(returnFinanceManagementRequest({ id: request.id, decisionNote: normalizedNote })).unwrap();
      } else {
        await dispatch(rejectFinanceManagementRequest({ id: request.id, decisionNote: normalizedNote })).unwrap();
      }
      setDecisionNote("");
      setPendingDecision(null);
      setSelectedRequest(null);
      await dispatch(fetchFinanceManagementRequests());
    } catch (error) {
      setDecisionError(getFinanceErrorMessage(error, "Unable to save this decision."));
    } finally {
      setDecisionBusy(false);
    }
  };

  const openCount = managementRequests.data.filter(
    (request) => request.status === "open" || request.status === "returned",
  ).length;

  const renderStatus = (request: FinanceManagementRequest) => (
    <Badge color={statusColor(request.status)} variant="light">
      {humanizeFinanceValue(request.status)}
    </Badge>
  );

  const renderReviewAction = (request: FinanceManagementRequest) => (
    <Tooltip label={request.status === "open" || request.status === "returned" ? "Review request" : "View request"}>
      <ActionIcon
        variant="light"
        color="blue"
        onClick={() => openRequest(request)}
        aria-label={`${request.status === "open" || request.status === "returned" ? "Review" : "View"} request ${request.id}`}
      >
        <IconEye size={18} />
      </ActionIcon>
    </Tooltip>
  );

  const requestIsActionable = selectedRequest?.status === "open" || selectedRequest?.status === "returned";

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        title="Management requests"
        description="Review finance changes that need a manager decision and keep the outcome auditable."
        icon={<IconFileInvoice size={24} />}
        actions={
          <Badge color={openCount > 0 ? "orange" : "teal"} variant="light" size="lg">
            {openCount} awaiting review
          </Badge>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search request, type, entity, or payload"
      >
        <Select
          placeholder="All statuses"
          aria-label="Filter management requests by status"
          data={[
            { value: "open", label: "Open" },
            { value: "returned", label: "Returned" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          style={{ flex: "1 1 160px", maxWidth: isMobile ? undefined : 200 }}
        />
        <Select
          placeholder="All priorities"
          aria-label="Filter management requests by priority"
          data={[
            { value: "high", label: "High priority" },
            { value: "normal", label: "Normal priority" },
            { value: "low", label: "Low priority" },
          ]}
          value={priorityFilter}
          onChange={setPriorityFilter}
          clearable
          style={{ flex: "1 1 170px", maxWidth: isMobile ? undefined : 210 }}
        />
      </FinanceToolbar>

      <FinancePanel
        title="Approval queue"
        description={`${groupedRequests.length} of ${managementRequests.data.length} requests shown`}
        noPadding
      >
        {managementRequests.error ? (
          <FinanceErrorState
            message={managementRequests.error}
            onRetry={() => void dispatch(fetchFinanceManagementRequests())}
          />
        ) : managementRequests.loading && managementRequests.data.length === 0 ? (
          <FinanceLoadingState label="Loading management requests" />
        ) : groupedRequests.length === 0 ? (
          <FinanceEmptyState
            icon={<IconFileInvoice size={25} />}
            title={managementRequests.data.length === 0 ? "No management requests" : "No matching requests"}
            description={
              managementRequests.data.length === 0
                ? "Finance changes that require a manager decision will appear here."
                : "Try clearing a filter or using a broader search."
            }
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {groupedRequests.map((request) => (
              <FinanceRecordCard
                key={request.id}
                leading={
                  <ThemeIcon variant="light" color={priorityColor(request.priority)} radius="md">
                    <IconFileInvoice size={17} />
                  </ThemeIcon>
                }
                title={humanizeFinanceValue(request.type)}
                subtitle={`${humanizeFinanceValue(request.targetEntity)}${request.targetId ? ` #${request.targetId}` : ""}`}
                status={renderStatus(request)}
                fields={[
                  { label: "Priority", value: humanizeFinanceValue(request.priority) },
                  { label: "Requested", value: formatFinanceDate(request.createdAt, true) },
                  { label: "Due", value: request.dueAt ? formatFinanceDate(request.dueAt) : "No due date" },
                  { label: "Request ID", value: `#${request.id}` },
                ]}
                actions={renderReviewAction(request)}
              />
            ))}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={960}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Request</Table.Th>
                  <Table.Th>Entity</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Priority</Table.Th>
                  <Table.Th>Requested</Table.Th>
                  <Table.Th>Due</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {groupedRequests.map((request) => (
                  <Table.Tr key={request.id}>
                    <Table.Td>
                      <Stack gap={1}>
                        <Text fw={700}>{humanizeFinanceValue(request.type)}</Text>
                        <Text size="xs" c="dimmed">Request #{request.id}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {humanizeFinanceValue(request.targetEntity)}{request.targetId ? ` #${request.targetId}` : ""}
                    </Table.Td>
                    <Table.Td>{renderStatus(request)}</Table.Td>
                    <Table.Td>
                      <Badge color={priorityColor(request.priority)} variant="light">
                        {humanizeFinanceValue(request.priority)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatFinanceDate(request.createdAt, true)}</Table.Td>
                    <Table.Td>{request.dueAt ? formatFinanceDate(request.dueAt) : "—"}</Table.Td>
                    <Table.Td ta="right">{renderReviewAction(request)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </FinancePanel>

      <FinanceModal
        opened={selectedRequest != null}
        onClose={closeRequest}
        title={selectedRequest ? `Request #${selectedRequest.id}` : "Finance request"}
        size="xl"
        scrollAreaComponent={ScrollArea.Autosize}
        closeOnClickOutside={!decisionBusy}
        closeOnEscape={!decisionBusy}
      >
        {selectedRequest && (
          <Stack gap="md">
            <Group gap="xs" wrap="wrap">
              <Badge variant="light" color="blue">{humanizeFinanceValue(selectedRequest.type)}</Badge>
              <Badge variant="light">{humanizeFinanceValue(selectedRequest.targetEntity)}</Badge>
              {renderStatus(selectedRequest)}
              <Badge variant="light" color={priorityColor(selectedRequest.priority)}>
                {humanizeFinanceValue(selectedRequest.priority)} priority
              </Badge>
            </Group>

            <FinanceFormSection title="Request summary" description="Who requested this change and when a decision is expected.">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {[
                  { label: "Requested", value: formatFinanceDate(selectedRequest.createdAt, true) },
                  { label: "Due", value: selectedRequest.dueAt ? formatFinanceDate(selectedRequest.dueAt) : "No due date" },
                  { label: "Requested by", value: `User #${selectedRequest.requestedBy}` },
                  { label: "Target", value: `${humanizeFinanceValue(selectedRequest.targetEntity)}${selectedRequest.targetId ? ` #${selectedRequest.targetId}` : ""}` },
                ].map((item) => (
                  <Paper key={item.label} withBorder radius="md" p="sm">
                    <Text size="xs" tt="uppercase" fw={800} c="dimmed">{item.label}</Text>
                    <Text mt={3} fw={650}>{item.value}</Text>
                  </Paper>
                ))}
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection title="Requested changes" description="The fields supplied with this finance request.">
              {Object.keys(selectedRequest.payload).length === 0 ? (
                <Text size="sm" c="dimmed">No structured fields were supplied with this request.</Text>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {Object.entries(selectedRequest.payload).map(([key, value]) => (
                    <Paper key={key} withBorder radius="md" p="sm">
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        {humanizeFinanceValue(key)}
                      </Text>
                      <Text component="div" mt={4} size="sm" fw={600} style={{ overflowWrap: "anywhere" }}>
                        {renderPayloadValue(key, value, selectedRequest.payload)}
                      </Text>
                    </Paper>
                  ))}
                </SimpleGrid>
              )}
              <Accordion variant="separated" radius="md">
                <Accordion.Item value="technical-payload">
                  <Accordion.Control>Technical payload</Accordion.Control>
                  <Accordion.Panel>
                    <Code block style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {JSON.stringify(selectedRequest.payload, null, 2)}
                    </Code>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </FinanceFormSection>

            {selectedRequest.decisionNote && !requestIsActionable && (
              <Alert color={selectedRequest.status === "approved" ? "green" : "gray"} title="Saved decision note">
                {selectedRequest.decisionNote}
              </Alert>
            )}

            {requestIsActionable && (
              <Textarea
                label="Decision note"
                description="Required when returning or rejecting; optional when approving."
                placeholder="Optional note for the requester"
                minRows={3}
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.currentTarget.value)}
              />
            )}

            {decisionError && <Alert color="red">{decisionError}</Alert>}

            <FinanceModalFooter>
              <Button variant="default" onClick={closeRequest} disabled={decisionBusy}>
                Close
              </Button>
              {requestIsActionable && (
                <>
                  <Button
                    color="orange"
                    variant="light"
                    leftSection={<IconArrowBackUp size={16} />}
                    onClick={() => requestDecision("return")}
                    disabled={decisionBusy}
                  >
                    Return for changes
                  </Button>
                  <Button
                    color="red"
                    variant="light"
                    leftSection={<IconX size={16} />}
                    onClick={() => requestDecision("reject")}
                    disabled={decisionBusy}
                  >
                    Reject
                  </Button>
                  <Button
                    color="green"
                    leftSection={<IconCheck size={16} />}
                    onClick={() => requestDecision("approve")}
                    disabled={decisionBusy}
                  >
                    Approve
                  </Button>
                </>
              )}
            </FinanceModalFooter>
          </Stack>
        )}
      </FinanceModal>

      <FinanceConfirmModal
        opened={pendingDecision != null && selectedRequest != null}
        onClose={() => {
          if (!decisionBusy) {
            setPendingDecision(null);
          }
        }}
        onConfirm={() => {
          if (pendingDecision && selectedRequest) {
            void handleDecision(pendingDecision, selectedRequest);
          }
        }}
        title={
          pendingDecision === "approve"
            ? "Approve finance request?"
            : pendingDecision === "return"
              ? "Return this request for changes?"
              : "Reject finance request?"
        }
        description={
          pendingDecision === "approve"
            ? "This will approve the requested finance change and record your decision."
            : pendingDecision === "return"
              ? "This will send the request back to its requester with your required note."
              : "This will reject the requested finance change and record your required note."
        }
        confirmLabel={
          pendingDecision === "approve"
            ? "Approve request"
            : pendingDecision === "return"
              ? "Return request"
              : "Reject request"
        }
        confirmColor={pendingDecision === "approve" ? "green" : pendingDecision === "return" ? "orange" : "red"}
        loading={decisionBusy}
      >
        {decisionNote.trim() && (
          <Alert color="gray" title="Decision note">
            {decisionNote.trim()}
          </Alert>
        )}
        {decisionError && <Alert color="red">{decisionError}</Alert>}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceManagementRequests;
