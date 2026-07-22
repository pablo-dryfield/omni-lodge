import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Radio,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconArrowsExchange, IconCheck, IconClipboardCheck, IconUserEdit, IconX } from "@tabler/icons-react";
import dayjs from "dayjs";
import { acknowledgeCerebroPolicy, submitCerebroQuiz } from "../../api/cerebro";
import {
  useCompleteRequiredAction,
  useCompleteRequiredProfileFields,
  useDecideRequiredManagerSwap,
  useMyRequiredActions,
  useRespondToRequiredSwap,
  type RequiredActionField,
  type RequiredActionItem,
} from "../../api/requiredActions";
import { CerebroRichTextContent } from "../cerebro/CerebroRichTextContent";

const HEADER_FONT_STACK = "'Arial Black', 'Inter', sans-serif";

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  const candidate = error as {
    response?: { data?: Array<{ message?: string }> | { message?: string; error?: string } };
    message?: string;
  };
  const data = candidate.response?.data;
  if (Array.isArray(data) && data[0]?.message) {
    return data[0].message;
  }
  if (!Array.isArray(data) && (data?.message || data?.error)) {
    return data.message ?? data.error ?? fallback;
  }
  return candidate.message ?? fallback;
};

const formatDateTime = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY HH:mm") : value;
};

const getPayloadRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const getUserName = (value: unknown, fallback: string): string => {
  const user = getPayloadRecord(value);
  const name = [user.firstName, user.lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return name || fallback;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "U").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
};

const formatRoleLabel = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "Role";
  }
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatShiftTime = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
};

const getSwapAssignmentSummary = (value: unknown) => {
  const assignment = getPayloadRecord(value);
  const shiftInstance = getPayloadRecord(assignment.shiftInstance);
  const shiftType = getPayloadRecord(shiftInstance.shiftType ?? assignment.shiftType);
  const dateValue = typeof assignment.date === "string" ? assignment.date : null;
  const timeStart = typeof assignment.timeStart === "string" ? assignment.timeStart : null;
  const timeEnd = typeof assignment.timeEnd === "string" ? assignment.timeEnd : null;
  const shiftTypeName =
    typeof assignment.shiftTypeName === "string" && assignment.shiftTypeName.trim()
      ? assignment.shiftTypeName
      : typeof shiftType.name === "string" && shiftType.name.trim()
        ? shiftType.name
        : typeof assignment.shiftType === "string" && assignment.shiftType.trim()
          ? assignment.shiftType
          : "Shift";
  return {
    date: dateValue && dayjs(dateValue).isValid() ? dayjs(dateValue).format("ddd, MMM D") : "Unknown date",
    time: [formatShiftTime(timeStart), formatShiftTime(timeEnd)].filter(Boolean).join(" - ") || "Any time",
    shiftTypeName,
    role: formatRoleLabel(assignment.roleInShift),
  };
};

const getActionIcon = (action: RequiredActionItem) => {
  if (action.type === "schedule_swap_partner" || action.type === "schedule_swap_manager") {
    return <IconArrowsExchange size={28} />;
  }
  if (action.type === "profile_fields") {
    return <IconUserEdit size={28} />;
  }
  return <IconClipboardCheck size={28} />;
};

const ProfileFieldsForm = ({
  action,
  onSubmit,
  loading,
}: {
  action: RequiredActionItem;
  onSubmit: (values: Record<string, string>) => void;
  loading: boolean;
}) => {
  const fields = useMemo(() => action.payload.fields ?? [], [action.payload.fields]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(
      fields.reduce<Record<string, string>>((acc, field) => {
        acc[field.key] = field.currentValue ?? "";
        return acc;
      }, {}),
    );
  }, [fields]);

  const updateValue = (field: RequiredActionField, value: string) => {
    setValues((current) => ({
      ...current,
      [field.key]: field.inputType === "tel" ? value.replace(/\D/g, "") : value,
    }));
  };

  return (
    <Stack gap="md">
      <SimpleFieldGrid>
        {fields.map((field) =>
          field.inputType === "textarea" ? (
            <Textarea
              key={field.key}
              label={field.label}
              value={values[field.key] ?? ""}
              onChange={(event) => updateValue(field, event.currentTarget.value)}
              autosize
              minRows={3}
              required
              styles={{ label: { width: "100%", textAlign: "center" }, input: { textAlign: "center" } }}
            />
          ) : (
            <TextInput
              key={field.key}
              label={field.label}
              type={field.inputType === "date" ? "date" : "text"}
              inputMode={field.inputType === "tel" ? "numeric" : undefined}
              value={values[field.key] ?? ""}
              onChange={(event) => updateValue(field, event.currentTarget.value)}
              required
              styles={{ label: { width: "100%", textAlign: "center" }, input: { textAlign: "center" } }}
            />
          ),
        )}
      </SimpleFieldGrid>
      <Button size="lg" fullWidth loading={loading} onClick={() => onSubmit(values)}>
        Save and continue
      </Button>
    </Stack>
  );
};

const SimpleFieldGrid = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16,
    }}
  >
    {children}
  </div>
);

const SwapAction = ({
  action,
  onRespond,
  loading,
}: {
  action: RequiredActionItem;
  onRespond: (accept: boolean) => void;
  loading: boolean;
}) => {
  const isManagerDecision = action.type === "schedule_swap_manager";
  const requesterName = getUserName(action.payload.requester, "Teammate");
  const partnerName = getUserName(action.payload.partner, "Teammate");
  const fromAssignment = getSwapAssignmentSummary(action.payload.fromAssignment);
  const toAssignment = getSwapAssignmentSummary(action.payload.toAssignment);

  const renderSwapCard = ({
    label,
    name,
    assignment,
    tone,
  }: {
    label: string;
    name: string;
    assignment: ReturnType<typeof getSwapAssignmentSummary>;
    tone: "offer" | "request";
  }) => {
    const accent = tone === "offer" ? "#2563EB" : "#e90183";
    const borderColor = tone === "offer" ? "#93C5FD" : "#F9A8D4";
    const headerBackground =
      tone === "offer"
        ? "linear-gradient(135deg, rgba(37, 99, 235, 0.16), rgba(147, 197, 253, 0.18))"
        : "linear-gradient(135deg, rgba(233, 1, 131, 0.16), rgba(244, 114, 182, 0.16))";
    const softBackground =
      tone === "offer"
        ? "linear-gradient(180deg, rgba(239, 246, 255, 0.98), rgba(255, 255, 255, 0.98))"
        : "linear-gradient(180deg, rgba(253, 242, 248, 0.98), rgba(255, 255, 255, 0.98))";

    return (
      <Paper
        withBorder
        radius={18}
        style={{
          width: "100%",
          overflow: "hidden",
          border: `2px solid ${borderColor}`,
          background: softBackground,
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
        }}
      >
        <Stack gap={0}>
          <Center
            style={{
              minHeight: 34,
              background: headerBackground,
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
                fontSize: 12,
              }}
            >
              {label}
            </Text>
          </Center>

          <Stack gap={6} align="center" p={{ base: 7, sm: 9 }}>
            <Group gap={7} justify="center" wrap="nowrap" style={{ width: "100%" }}>
              <Center
                style={{
                  width: 38,
                  height: 38,
                  flex: "0 0 38px",
                  borderRadius: "50%",
                  backgroundColor: "#FFFFFF",
                  border: "2px solid #FFFFFF",
                  outline: `2px solid ${accent}`,
                  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14)",
                }}
              >
                <Text fw={900} size="sm" c={accent} style={{ fontFamily: HEADER_FONT_STACK }}>
                  {getInitials(name)}
                </Text>
              </Center>
              <Stack gap={2} align="center" style={{ minWidth: 0 }}>
                <Text fw={900} size="sm" ta="center" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1.1 }}>
                  {name}
                </Text>
                <Badge variant="light" color={tone === "offer" ? "blue" : "violet"} radius="xl" size="xs">
                  {assignment.role}
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
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              {assignment.shiftTypeName}
            </Text>

            <div
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 7,
              }}
            >
              <BoxInfo label="Date" value={assignment.date} />
              <BoxInfo label="Time" value={assignment.time} />
            </div>
          </Stack>
        </Stack>
      </Paper>
    );
  };

  return (
    <Stack gap="sm" align="center">
      <Stack gap={6} align="center">
        <Title
          order={2}
          ta="center"
          style={{
            fontFamily: HEADER_FONT_STACK,
            fontWeight: 900,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          Swap request
        </Title>
        <Text c="dimmed" ta="center" fw={700}>
          {isManagerDecision
            ? `${requesterName} and ${partnerName} accepted this swap.`
            : `${requesterName} wants to swap shifts with you.`}
        </Text>
      </Stack>

      {renderSwapCard({
        label: isManagerDecision ? "Requester offers" : "They offer",
        name: requesterName,
        assignment: fromAssignment,
        tone: "offer",
      })}

      <Center
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          backgroundColor: "#111827",
          color: "#FFFFFF",
          boxShadow: "0 12px 22px rgba(15, 23, 42, 0.18)",
        }}
      >
        <IconArrowsExchange size={19} />
      </Center>

      {renderSwapCard({
        label: isManagerDecision ? "Teammate gives" : "You give",
        name: isManagerDecision ? partnerName : "You",
        assignment: toAssignment,
        tone: "request",
      })}

      <Alert color="blue" radius="md" variant="light" w="100%">
        <Text size="sm" fw={900} ta="center" style={{ fontFamily: HEADER_FONT_STACK }}>
          {isManagerDecision ? "Approve to update the schedule." : "Manager will receive the request."}
        </Text>
      </Alert>

      <Group grow>
        <Button color="red" size="lg" leftSection={<IconX size={18} />} loading={loading} onClick={() => onRespond(false)}>
          {isManagerDecision ? "Decline swap" : "Decline"}
        </Button>
        <Button color="green" size="lg" leftSection={<IconCheck size={18} />} loading={loading} onClick={() => onRespond(true)}>
          {isManagerDecision ? "Approve swap" : "Accept"}
        </Button>
      </Group>
    </Stack>
  );
};

const BoxInfo = ({ label, value }: { label: string; value: string }) => (
  <Paper
    withBorder
    radius={14}
    p={7}
    style={{
      backgroundColor: "#FFFFFF",
      textAlign: "center",
    }}
  >
    <Text size="xs" fw={900} c="dimmed" tt="uppercase" style={{ fontFamily: HEADER_FONT_STACK }}>
      {label}
    </Text>
    <Text fw={900} size="md" style={{ fontFamily: HEADER_FONT_STACK, lineHeight: 1.15 }}>
      {value}
    </Text>
  </Paper>
);

const GenericAction = ({
  action,
  onComplete,
  loading,
}: {
  action: RequiredActionItem;
  onComplete: () => void;
  loading: boolean;
}) => (
  <Stack gap="lg">
    {action.body ? (
      <Paper withBorder radius="md" p="lg">
        <Text ta="center" style={{ whiteSpace: "pre-wrap" }}>
          {action.body}
        </Text>
      </Paper>
    ) : null}
    <Button size="lg" fullWidth loading={loading} onClick={onComplete}>
      {action.type === "policy_consent" ? "I agree" : "Mark complete"}
    </Button>
  </Stack>
);

const PolicyAction = ({
  action,
  onAccept,
  loading,
}: {
  action: RequiredActionItem;
  onAccept: () => void;
  loading: boolean;
}) => {
  const entry = action.payload.cerebroEntry;
  if (!entry) {
    return <GenericAction action={action} onComplete={onAccept} loading={loading} />;
  }

  return (
    <Stack gap="lg">
      <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
        <Stack gap="md">
          <Group justify="center" gap="xs">
            <Badge variant="light">Version {entry.policyVersion ?? "current"}</Badge>
            {entry.estimatedReadMinutes ? <Badge variant="light">{entry.estimatedReadMinutes} min read</Badge> : null}
          </Group>
          <CerebroRichTextContent value={entry.body} />
        </Stack>
      </Paper>
      <Button size="lg" fullWidth loading={loading} onClick={onAccept}>
        I agree
      </Button>
    </Stack>
  );
};

const QuizAction = ({
  action,
  onSubmit,
  loading,
  resultText,
}: {
  action: RequiredActionItem;
  onSubmit: (answers: Record<string, string>) => void;
  loading: boolean;
  resultText: string | null;
}) => {
  const quiz = action.payload.cerebroQuiz;
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setAnswers({});
  }, [quiz?.id]);

  if (!quiz) {
    return <GenericAction action={action} onComplete={() => onSubmit({})} loading={loading} />;
  }

  const complete = quiz.questions.every((question) => Boolean(answers[question.id]));

  return (
    <Stack gap="md">
      <Group justify="center" gap="xs">
        <Badge variant="light">Pass {quiz.passingScore}%</Badge>
        <Badge variant="light">{quiz.questions.length} questions</Badge>
      </Group>
      {quiz.description ? (
        <Text c="dimmed" ta="center">
          {quiz.description}
        </Text>
      ) : null}
      {quiz.questions.map((question, index) => (
        <Paper key={question.id} withBorder radius="md" p="md">
          <Stack gap="sm">
            <Text fw={700} ta="center">
              {index + 1}. {question.prompt}
            </Text>
            <Radio.Group
              value={answers[question.id] ?? ""}
              onChange={(value) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: value,
                }))
              }
            >
              <Stack gap="xs" align="center">
                {question.options.map((option) => (
                  <Radio key={option.id} value={option.id} label={option.label} />
                ))}
              </Stack>
            </Radio.Group>
          </Stack>
        </Paper>
      ))}
      {resultText ? (
        <Alert color="orange" icon={<IconAlertCircle size={16} />}>
          {resultText}
        </Alert>
      ) : null}
      <Button size="lg" fullWidth loading={loading} disabled={!complete} onClick={() => onSubmit(answers)}>
        Submit quiz
      </Button>
    </Stack>
  );
};

export const RequiredActionsOverlay = ({ enabled }: { enabled: boolean }) => {
  const actionsQuery = useMyRequiredActions(enabled);
  const queryClient = useQueryClient();
  const completeAction = useCompleteRequiredAction();
  const completeProfileFields = useCompleteRequiredProfileFields();
  const respondToSwap = useRespondToRequiredSwap();
  const decideManagerSwap = useDecideRequiredManagerSwap();
  const [error, setError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<string | null>(null);
  const [cerebroSubmitting, setCerebroSubmitting] = useState(false);

  const actions = actionsQuery.data?.actions ?? [];
  const action = actions[0] ?? null;
  const isBusy =
    completeAction.isPending ||
    completeProfileFields.isPending ||
    respondToSwap.isPending ||
    decideManagerSwap.isPending ||
    cerebroSubmitting ||
    actionsQuery.isFetching;
  const progress = actions.length > 0 ? ((actionsQuery.data?.summary.total ?? actions.length) - actions.length + 1) / (actionsQuery.data?.summary.total ?? actions.length) : 0;

  useEffect(() => {
    setError(null);
    setQuizResult(null);
  }, [action?.id]);

  const handleComplete = async () => {
    if (!action || action.source !== "required_action") {
      return;
    }
    setError(null);
    try {
      await completeAction.mutateAsync({ actionId: action.recordId, response: { acknowledgedAt: new Date().toISOString() } });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to complete this required action"));
    }
  };

  const handleProfileSubmit = async (values: Record<string, string>) => {
    if (!action || action.type !== "profile_fields") {
      return;
    }
    setError(null);
    try {
      await completeProfileFields.mutateAsync({ actionId: action.recordId, values });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to save your details"));
    }
  };

  const handleSwapResponse = async (accept: boolean) => {
    if (!action || (action.type !== "schedule_swap_partner" && action.type !== "schedule_swap_manager")) {
      return;
    }
    setError(null);
    try {
      if (action.type === "schedule_swap_manager") {
        await decideManagerSwap.mutateAsync({ swapId: action.recordId, approve: accept });
      } else {
        await respondToSwap.mutateAsync({ swapId: action.recordId, accept });
      }
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to update the swap request"));
    }
  };

  const handlePolicyAccept = async () => {
    const entryId = action?.payload.cerebroEntry?.id;
    if (!entryId) {
      await handleComplete();
      return;
    }
    setError(null);
    try {
      setCerebroSubmitting(true);
      await acknowledgeCerebroPolicy(entryId);
      await queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to accept this policy"));
    } finally {
      setCerebroSubmitting(false);
    }
  };

  const handleQuizSubmit = async (answers: Record<string, string>) => {
    const quizId = action?.payload.cerebroQuiz?.id;
    if (!quizId) {
      return;
    }
    setError(null);
    setQuizResult(null);
    try {
      setCerebroSubmitting(true);
      const result = await submitCerebroQuiz(quizId, answers);
      if (!result.passed) {
        setQuizResult(`You scored ${result.scorePercent.toFixed(0)}%. You need ${action.payload.cerebroQuiz?.passingScore ?? 80}% to continue.`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["required-actions", "me"] });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, "Unable to submit this quiz"));
    } finally {
      setCerebroSubmitting(false);
    }
  };

  const isSwapAction = action?.type === "schedule_swap_partner" || action?.type === "schedule_swap_manager";

  return (
    <Modal
      opened={enabled && actions.length > 0}
      onClose={() => undefined}
      fullScreen
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      trapFocus
      zIndex={5000}
      padding={0}
      styles={{
        content: { background: "#f4f4f7" },
        body: { minHeight: "100dvh" },
      }}
    >
      <Center mih="100dvh" p={{ base: "md", sm: "xl" }}>
        <Card
          withBorder={!isSwapAction}
          radius={isSwapAction ? 0 : "lg"}
          shadow={isSwapAction ? undefined : "xl"}
          p={isSwapAction ? 0 : { base: "lg", sm: "xl" }}
          w="100%"
          maw={isSwapAction ? 420 : 760}
          style={{
            background: isSwapAction ? "transparent" : undefined,
            border: isSwapAction ? 0 : undefined,
          }}
        >
          {!action ? (
            <Center py="xl">
              <Loader variant="dots" />
            </Center>
          ) : (
            <Stack gap="lg" align="stretch">
              {action.type === "schedule_swap_partner" || action.type === "schedule_swap_manager" ? null : (
                <Stack gap="sm" align="center">
                  <ThemeIcon size={64} radius="xl" color="blue" variant="light">
                    {getActionIcon(action)}
                  </ThemeIcon>
                  <Badge color="red" variant="light" size="lg">
                    Action required
                  </Badge>
                  <Title order={2} ta="center">
                    {action.title}
                  </Title>
                  {action.body && action.type !== "broadcast" && action.type !== "policy_consent" ? (
                    <Text c="dimmed" ta="center">
                      {action.body}
                    </Text>
                  ) : null}
                  {action.dueAt ? (
                    <Text size="sm" c="dimmed" ta="center">
                      Due {formatDateTime(action.dueAt)}
                    </Text>
                  ) : null}
                </Stack>
              )}

              {actions.length > 1 ? (
                <Stack gap={6}>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Pending items
                    </Text>
                    <Text size="sm" fw={700}>
                      {actions.length} left
                    </Text>
                  </Group>
                  <Progress value={Math.min(Math.max(progress * 100, 0), 100)} radius="xl" />
                </Stack>
              ) : null}

              {error ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />}>
                  {error}
                </Alert>
              ) : null}

              {action.type === "schedule_swap_partner" || action.type === "schedule_swap_manager" ? (
                <SwapAction action={action} onRespond={handleSwapResponse} loading={isBusy} />
              ) : action.type === "profile_fields" ? (
                <ProfileFieldsForm action={action} onSubmit={handleProfileSubmit} loading={isBusy} />
              ) : action.type === "policy_consent" ? (
                <PolicyAction action={action} onAccept={handlePolicyAccept} loading={isBusy} />
              ) : action.type === "quiz" ? (
                <QuizAction action={action} onSubmit={handleQuizSubmit} loading={isBusy} resultText={quizResult} />
              ) : (
                <GenericAction action={action} onComplete={handleComplete} loading={isBusy} />
              )}

              {actionsQuery.isFetching ? (
                <Text size="xs" c="dimmed" ta="center">
                  Syncing required actions...
                </Text>
              ) : null}
            </Stack>
          )}
        </Card>
      </Center>
    </Modal>
  );
};

export default RequiredActionsOverlay;
