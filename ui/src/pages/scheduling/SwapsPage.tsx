import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Modal, Select, Stack, Text, Textarea, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import dayjs from "dayjs";
import { useManagerShiftRequestDecision, useShiftRequests } from "../../api/scheduling";
import type { ShiftRequest, ShiftRequestType } from "../../types/scheduling";
import {
  getShiftRequestType,
  getShiftRequestTypeLabel,
  resolveShiftRequestAssignment,
  type ShiftRequestAssignmentLike,
} from "../../components/scheduling/shiftRequestPresentation";
import { useAppSelector } from "../../store/hooks";

const STATUS_OPTIONS = [
  { value: "pending_partner", label: "AWAITING TEAMMATE" },
  { value: "pending_manager", label: "AWAITING MANAGER" },
  { value: "approved", label: "APPROVED" },
  { value: "denied", label: "DENIED" },
  { value: "canceled", label: "CANCELED" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "ALL REQUEST TYPES" },
  { value: "swap", label: "SWAPS" },
  { value: "takeover", label: "TAKEOVERS" },
  { value: "drop", label: "DROPS" },
];

const formatUserName = (
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallbackId?: number | null,
) => {
  const name = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
  return name || (fallbackId ? `User #${fallbackId}` : "Teammate");
};

const describeShift = (assignment: ShiftRequestAssignmentLike | null | undefined) => {
  if (!assignment?.shiftInstance) return "Shift details unavailable.";
  const shift = assignment.shiftInstance;
  const date = shift.date ? dayjs(shift.date).format("ddd, MMM D") : "Unknown date";
  const time = [shift.timeStart, shift.timeEnd].filter(Boolean).join(" - ") || "Any time";
  return `${date} | ${shift.shiftType?.name ?? "Shift"} | ${time} | ${assignment.roleInShift || "Role"}`;
};

const SwapsPage = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId) ?? null;
  const [status, setStatus] = useState("pending_manager");
  const [requestType, setRequestType] = useState<ShiftRequestType | null>(null);
  const requestsQuery = useShiftRequests(status, requestType);
  const managerDecision = useManagerShiftRequestDecision();
  const [decision, setDecision] = useState<{ request: ShiftRequest; approve: boolean } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const statusLabelMap = useMemo(
    () => new Map<string, string>(STATUS_OPTIONS.map((option) => [option.value, option.label])),
    [],
  );

  const handleDecision = async () => {
    if (!decision) return;
    setError(null);
    try {
      await managerDecision.mutateAsync({
        requestId: decision.request.id,
        approve: decision.approve,
        ...(decisionNote.trim() ? { reason: decisionNote.trim() } : {}),
      });
      setDecision(null);
      setDecisionNote("");
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Unable to update this request.");
    }
  };

  const requests = requestsQuery.data ?? [];

  return (
    <Stack mt="lg" gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Title order={3}>Shift requests</Title>
        <Group grow={isMobile} w={isMobile ? "100%" : undefined}>
          <Select
            data={TYPE_OPTIONS}
            value={requestType ?? "all"}
            label="Request type"
            allowDeselect={false}
            onChange={(value) => setRequestType(value && value !== "all" ? (value as ShiftRequestType) : null)}
          />
          <Select data={STATUS_OPTIONS} value={status} label="Status" allowDeselect={false} onChange={(value) => value && setStatus(value)} />
        </Group>
      </Group>

      {requestsQuery.isError ? <Alert color="red" role="alert">Unable to load shift requests.</Alert> : null}

      <Stack gap="md">
        {requests.length === 0 ? (
          <Text size="sm" c="dimmed">No shift requests in this state.</Text>
        ) : (
          requests.map((request) => {
            const type = getShiftRequestType(request);
            const fromAssignment = resolveShiftRequestAssignment(request, "from");
            const toAssignment = resolveShiftRequestAssignment(request, "to");
            const requesterName = formatUserName(request.requester, request.requesterId);
            const partnerName = formatUserName(request.partner, request.partnerId);
            const requiresIndependentManager = loggedUserId != null
              && (request.requesterId === loggedUserId || request.partnerId === loggedUserId);
            return (
              <Card key={request.id} withBorder radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={2}>
                      <Text fw={700}>{getShiftRequestTypeLabel(type)} request #{request.id}</Text>
                      <Text size="xs" c="dimmed">
                        Requested by {requesterName}{request.createdAt ? ` on ${dayjs(request.createdAt).format("MMM D, YYYY HH:mm")}` : ""}
                      </Text>
                    </Stack>
                    <Group gap="xs">
                      <Badge color={type === "takeover" ? "teal" : type === "drop" ? "orange" : "violet"}>{getShiftRequestTypeLabel(type)}</Badge>
                      <Badge>{statusLabelMap.get(request.status) ?? request.status.toUpperCase()}</Badge>
                    </Group>
                  </Group>

                  {type === "swap" ? (
                    <Stack gap={4}>
                      <Text size="sm"><b>{requesterName} offers:</b> {describeShift(fromAssignment)}</Text>
                      <Text size="sm"><b>{partnerName} offers:</b> {describeShift(toAssignment)}</Text>
                    </Stack>
                  ) : type === "takeover" ? (
                    <Stack gap={4}>
                      <Text size="sm"><b>{requesterName}</b> will take over <b>{partnerName}&apos;s</b> shift.</Text>
                      <Text size="sm">{describeShift(fromAssignment)}</Text>
                    </Stack>
                  ) : (
                    <Stack gap={4}>
                      <Text size="sm"><b>{requesterName}</b> wants to drop this shift.</Text>
                      <Text size="sm">{describeShift(fromAssignment)}</Text>
                    </Stack>
                  )}

                  {request.requestNote ? <Alert color="blue"><b>Request note:</b> {request.requestNote}</Alert> : null}
                  {request.partnerResponseNote ? <Alert color="teal"><b>Teammate note:</b> {request.partnerResponseNote}</Alert> : null}
                  {request.decisionReason ? (
                    <Alert color="gray">
                      <b>{request.status === "canceled" ? "Cancellation note:" : "Manager note:"}</b>{" "}
                      {request.decisionReason}
                    </Alert>
                  ) : null}

                  {status === "pending_manager" && requiresIndependentManager ? (
                    <Alert color="yellow">
                      A different manager must make the final decision because you are involved in this request.
                    </Alert>
                  ) : null}

                  {status === "pending_manager" ? (
                    <Group>
                      <Button size="xs" color="green" disabled={requiresIndependentManager} onClick={() => { setError(null); setDecisionNote(""); setDecision({ request, approve: true }); }}>Approve</Button>
                      <Button size="xs" color="red" variant="light" disabled={requiresIndependentManager} onClick={() => { setError(null); setDecisionNote(""); setDecision({ request, approve: false }); }}>Deny</Button>
                    </Group>
                  ) : null}
                </Stack>
              </Card>
            );
          })
        )}
      </Stack>

      <Modal
        opened={Boolean(decision)}
        onClose={() => {
          if (!managerDecision.isPending) {
            setDecision(null);
            setDecisionNote("");
            setError(null);
          }
        }}
        title={`${decision?.approve ? "Approve" : "Deny"} ${decision ? getShiftRequestTypeLabel(getShiftRequestType(decision.request)).toLowerCase() : "shift"} request`}
        centered
        fullScreen={isMobile}
      >
        <Stack gap="md">
          <Text fw={700} ta="center">
            {decision?.approve
              ? getShiftRequestType(decision.request) === "drop"
                ? "Approve this drop request? The assignment will be removed and the role will remain unfilled."
                : getShiftRequestType(decision.request) === "takeover"
                  ? "Approve this takeover request and transfer the assignment to the requester?"
                  : "Approve this swap request and exchange both assignments?"
              : "Deny this request without changing the schedule?"}
          </Text>
          <Textarea
            label="Manager note (optional)"
            placeholder="Add context for the staff members"
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.currentTarget.value)}
            maxLength={2000}
            autosize
            minRows={3}
          />
          {error ? <Alert color="red" role="alert">{error}</Alert> : null}
          <Group grow>
            <Button variant="light" color="gray" onClick={() => setDecision(null)} disabled={managerDecision.isPending}>Cancel</Button>
            <Button color={decision?.approve ? "green" : "red"} onClick={handleDecision} loading={managerDecision.isPending}>
              {decision?.approve ? "Approve request" : "Deny request"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default SwapsPage;
