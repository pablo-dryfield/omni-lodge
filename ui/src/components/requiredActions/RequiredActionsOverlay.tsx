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
  useMyRequiredActions,
  useRespondToRequiredSwap,
  type RequiredActionField,
  type RequiredActionItem,
} from "../../api/requiredActions";
import { CerebroRichTextContent } from "../cerebro/CerebroRichTextContent";

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

const formatShift = (value: unknown): string => {
  const assignment = value as {
    date?: string | null;
    timeStart?: string | null;
    timeEnd?: string | null;
    shiftTypeName?: string | null;
    roleInShift?: string | null;
  };
  const date = assignment.date ? dayjs(assignment.date).format("ddd, MMM D") : "Unknown date";
  const time = [assignment.timeStart, assignment.timeEnd].filter(Boolean).join(" - ");
  const shift = assignment.shiftTypeName ?? "Shift";
  const role = assignment.roleInShift ?? "Role";
  return `${date} - ${shift}${time ? ` - ${time}` : ""} - ${role}`;
};

const getActionIcon = (action: RequiredActionItem) => {
  if (action.type === "schedule_swap_partner") {
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
}) => (
  <Stack gap="md">
    <Paper withBorder radius="md" p="md">
      <Stack gap="xs" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          They give you
        </Text>
        <Text fw={700} ta="center">
          {formatShift(action.payload.fromAssignment)}
        </Text>
      </Stack>
    </Paper>
    <Paper withBorder radius="md" p="md">
      <Stack gap="xs" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          You give them
        </Text>
        <Text fw={700} ta="center">
          {formatShift(action.payload.toAssignment)}
        </Text>
      </Stack>
    </Paper>
    <Group grow>
      <Button color="red" variant="light" size="lg" leftSection={<IconX size={18} />} loading={loading} onClick={() => onRespond(false)}>
        Decline
      </Button>
      <Button color="green" size="lg" leftSection={<IconCheck size={18} />} loading={loading} onClick={() => onRespond(true)}>
        Accept
      </Button>
    </Group>
  </Stack>
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
  const [error, setError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<string | null>(null);
  const [cerebroSubmitting, setCerebroSubmitting] = useState(false);

  const actions = actionsQuery.data?.actions ?? [];
  const action = actions[0] ?? null;
  const isBusy =
    completeAction.isPending ||
    completeProfileFields.isPending ||
    respondToSwap.isPending ||
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
    if (!action || action.type !== "schedule_swap_partner") {
      return;
    }
    setError(null);
    try {
      await respondToSwap.mutateAsync({ swapId: action.recordId, accept });
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
        <Card withBorder radius="lg" shadow="xl" p={{ base: "lg", sm: "xl" }} w="100%" maw={760}>
          {!action ? (
            <Center py="xl">
              <Loader variant="dots" />
            </Center>
          ) : (
            <Stack gap="lg" align="stretch">
              <Stack gap="sm" align="center">
                <ThemeIcon size={64} radius="xl" color={action.type === "schedule_swap_partner" ? "orange" : "blue"} variant="light">
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

              {action.type === "schedule_swap_partner" ? (
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
