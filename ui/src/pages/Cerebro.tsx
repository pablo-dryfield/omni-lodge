import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Image,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Radio,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconChecklist, IconFileText, IconPlus, IconShieldCheck } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acknowledgeCerebroPolicy,
  createCerebroEntry,
  createCerebroQuiz,
  type CerebroAcknowledgement,
  createCerebroSection,
  type CerebroEntry,
  type CerebroQuiz,
  type CerebroQuizAttempt,
  type CerebroSection,
  submitCerebroQuiz,
  updateCerebroEntry,
  updateCerebroQuiz,
  updateCerebroSection,
  useCerebroBootstrap,
} from "../api/cerebro";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.cerebro;

type ViewMode = "knowledge" | "quizzes" | "policies" | "admin";
type EntryKind = CerebroEntry["kind"];

type SectionFormState = {
  id: number | null;
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
  status: boolean;
};

type EntryFormState = {
  id: number | null;
  sectionId: string | null;
  title: string;
  slug: string;
  category: string;
  kind: EntryKind;
  summary: string;
  body: string;
  mediaLines: string;
  checklistLines: string;
  targetUserTypeIds: string[];
  requiresAcknowledgement: boolean;
  policyVersion: string;
  estimatedReadMinutes: string;
  sortOrder: string;
  status: boolean;
};

type QuizFormState = {
  id: number | null;
  entryId: string | null;
  title: string;
  slug: string;
  description: string;
  targetUserTypeIds: string[];
  passingScore: string;
  questionsJson: string;
  sortOrder: string;
  status: boolean;
};

const emptySectionForm = (): SectionFormState => ({
  id: null,
  name: "",
  slug: "",
  description: "",
  sortOrder: "0",
  status: true,
});

const emptyEntryForm = (): EntryFormState => ({
  id: null,
  sectionId: null,
  title: "",
  slug: "",
  category: "",
  kind: "faq",
  summary: "",
  body: "",
  mediaLines: "",
  checklistLines: "",
  targetUserTypeIds: [],
  requiresAcknowledgement: false,
  policyVersion: "",
  estimatedReadMinutes: "",
  sortOrder: "0",
  status: true,
});

const emptyQuizForm = (): QuizFormState => ({
  id: null,
  entryId: null,
  title: "",
  slug: "",
  description: "",
  targetUserTypeIds: [],
  passingScore: "80",
  questionsJson: JSON.stringify(
    [
      {
        id: "question-1",
        prompt: "What should this role know first?",
        options: [
          { id: "a", label: "Correct answer" },
          { id: "b", label: "Distractor" },
        ],
        correctOptionId: "a",
        explanation: "Explain why this is correct.",
      },
    ],
    null,
    2,
  ),
  sortOrder: "0",
  status: true,
});

const formatError = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const payload = error as { response?: { data?: unknown } };
    const data = payload.response?.data;
    if (Array.isArray(data) && typeof data[0]?.message === "string") {
      return data[0].message;
    }
  }
  return "Something went wrong.";
};

const parseMediaLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [typeRaw, urlRaw, captionRaw = ""] = line.split("|");
      return {
        type: typeRaw?.trim() === "gif" ? "gif" : "image",
        url: urlRaw?.trim() ?? "",
        caption: captionRaw.trim() || null,
      };
    })
    .filter((item) => item.url.length > 0);

const formatMediaLines = (media: CerebroEntry["media"]) =>
  media.map((item) => `${item.type}|${item.url}|${item.caption ?? ""}`).join("\n");

const Cerebro = () => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useCerebroBootstrap();
  const [view, setView] = useState<ViewMode>("knowledge");
  const [searchQuery, setSearchQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string | null>("all");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [quizDrafts, setQuizDrafts] = useState<Record<number, Record<string, string>>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [sectionForm, setSectionForm] = useState<SectionFormState>(emptySectionForm);
  const [entryForm, setEntryForm] = useState<EntryFormState>(emptyEntryForm);
  const [quizForm, setQuizForm] = useState<QuizFormState>(emptyQuizForm);

  const roleOptions = useMemo(
    () => (data?.userTypes ?? []).map((item) => ({ value: String(item.id), label: item.name })),
    [data?.userTypes],
  );
  const sectionOptions = useMemo(
    () => [
      { value: "all", label: "All sections" },
      ...((data?.sections ?? []).map((section) => ({ value: String(section.id), label: section.name }))),
    ],
    [data?.sections],
  );
  const entryOptions = useMemo(
    () => (data?.entries ?? []).map((entry) => ({ value: String(entry.id), label: entry.title })),
    [data?.entries],
  );

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (data?.entries ?? []).filter((entry) => {
      if (sectionFilter && sectionFilter !== "all" && String(entry.sectionId) !== sectionFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [entry.title, entry.summary ?? "", entry.body, entry.category ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [data?.entries, searchQuery, sectionFilter]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedEntryId(null);
      return;
    }
    if (!filteredEntries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(filteredEntries[0].id);
    }
  }, [filteredEntries, selectedEntryId]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [filteredEntries, selectedEntryId],
  );

  const latestAttemptByQuizId = useMemo(() => {
    const map = new Map<number, CerebroQuizAttempt>();
    (data?.attempts ?? []).forEach((attempt) => {
      const existing = map.get(attempt.quizId);
      if (!existing || new Date(existing.submittedAt).getTime() < new Date(attempt.submittedAt).getTime()) {
        map.set(attempt.quizId, attempt);
      }
    });
    return map;
  }, [data?.attempts]);

  const acknowledgementByEntryId = useMemo(() => {
    const map = new Map<number, CerebroAcknowledgement>();
    (data?.acknowledgements ?? []).forEach((ack) => map.set(ack.entryId, ack));
    return map;
  }, [data?.acknowledgements]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["cerebro", "bootstrap"] });
  };

  const sectionMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: sectionForm.name.trim(),
        slug: sectionForm.slug.trim() || undefined,
        description: sectionForm.description.trim() || null,
        sortOrder: Number(sectionForm.sortOrder) || 0,
        status: sectionForm.status,
      };
      return sectionForm.id ? updateCerebroSection(sectionForm.id, payload) : createCerebroSection(payload);
    },
    onSuccess: async () => {
      await invalidate();
      setFeedback(`Section ${sectionForm.id ? "updated" : "created"} successfully.`);
      setSectionModalOpen(false);
      setSectionForm(emptySectionForm());
    },
    onError: (mutationError) => setErrorMessage(formatError(mutationError)),
  });

  const entryMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        sectionId: Number(entryForm.sectionId),
        title: entryForm.title.trim(),
        slug: entryForm.slug.trim() || undefined,
        category: entryForm.category.trim() || null,
        kind: entryForm.kind,
        summary: entryForm.summary.trim() || null,
        body: entryForm.body,
        media: parseMediaLines(entryForm.mediaLines),
        checklistItems: entryForm.checklistLines.split("\n").map((item) => item.trim()).filter(Boolean),
        targetUserTypeIds: entryForm.targetUserTypeIds.map(Number),
        requiresAcknowledgement: entryForm.requiresAcknowledgement,
        policyVersion: entryForm.policyVersion.trim() || null,
        estimatedReadMinutes: entryForm.estimatedReadMinutes.trim() ? Number(entryForm.estimatedReadMinutes) : null,
        sortOrder: Number(entryForm.sortOrder) || 0,
        status: entryForm.status,
      };
      return entryForm.id ? updateCerebroEntry(entryForm.id, payload) : createCerebroEntry(payload);
    },
    onSuccess: async () => {
      await invalidate();
      setFeedback(`Article ${entryForm.id ? "updated" : "created"} successfully.`);
      setEntryModalOpen(false);
      setEntryForm(emptyEntryForm());
    },
    onError: (mutationError) => setErrorMessage(formatError(mutationError)),
  });

  const quizMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        entryId: quizForm.entryId ? Number(quizForm.entryId) : null,
        title: quizForm.title.trim(),
        slug: quizForm.slug.trim() || undefined,
        description: quizForm.description.trim() || null,
        targetUserTypeIds: quizForm.targetUserTypeIds.map(Number),
        passingScore: Number(quizForm.passingScore) || 80,
        questions: JSON.parse(quizForm.questionsJson),
        sortOrder: Number(quizForm.sortOrder) || 0,
        status: quizForm.status,
      };
      return quizForm.id ? updateCerebroQuiz(quizForm.id, payload) : createCerebroQuiz(payload);
    },
    onSuccess: async () => {
      await invalidate();
      setFeedback(`Quiz ${quizForm.id ? "updated" : "created"} successfully.`);
      setQuizModalOpen(false);
      setQuizForm(emptyQuizForm());
    },
    onError: (mutationError) => setErrorMessage(formatError(mutationError)),
  });

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeCerebroPolicy,
    onSuccess: async () => {
      await invalidate();
      setFeedback("Policy acknowledged.");
    },
    onError: (mutationError) => setErrorMessage(formatError(mutationError)),
  });

  const submitQuizMutation = useMutation({
    mutationFn: ({ quizId, answers }: { quizId: number; answers: Record<string, string> }) =>
      submitCerebroQuiz(quizId, answers),
    onSuccess: async (result) => {
      await invalidate();
      setFeedback(`${result.passed ? "Passed" : "Submitted"} with ${result.scorePercent.toFixed(0)}%.`);
    },
    onError: (mutationError) => setErrorMessage(formatError(mutationError)),
  });

  const openSectionEditor = (section?: CerebroSection) => {
    setErrorMessage(null);
    setSectionForm(
      section
        ? {
            id: section.id,
            name: section.name,
            slug: section.slug,
            description: section.description ?? "",
            sortOrder: String(section.sortOrder),
            status: section.status,
          }
        : emptySectionForm(),
    );
    setSectionModalOpen(true);
  };

  const openEntryEditor = (entry?: CerebroEntry) => {
    setErrorMessage(null);
    setEntryForm(
      entry
        ? {
            id: entry.id,
            sectionId: String(entry.sectionId),
            title: entry.title,
            slug: entry.slug,
            category: entry.category ?? "",
            kind: entry.kind,
            summary: entry.summary ?? "",
            body: entry.body,
            mediaLines: formatMediaLines(entry.media),
            checklistLines: entry.checklistItems.join("\n"),
            targetUserTypeIds: entry.targetUserTypeIds.map(String),
            requiresAcknowledgement: entry.requiresAcknowledgement,
            policyVersion: entry.policyVersion ?? "",
            estimatedReadMinutes: entry.estimatedReadMinutes ? String(entry.estimatedReadMinutes) : "",
            sortOrder: String(entry.sortOrder),
            status: entry.status,
          }
        : emptyEntryForm(),
    );
    setEntryModalOpen(true);
  };

  const openQuizEditor = (quiz?: CerebroQuiz) => {
    setErrorMessage(null);
    setQuizForm(
      quiz
        ? {
            id: quiz.id,
            entryId: quiz.entryId ? String(quiz.entryId) : null,
            title: quiz.title,
            slug: quiz.slug,
            description: quiz.description ?? "",
            targetUserTypeIds: quiz.targetUserTypeIds.map(String),
            passingScore: String(quiz.passingScore),
            questionsJson: JSON.stringify(quiz.questions, null, 2),
            sortOrder: String(quiz.sortOrder),
            status: quiz.status,
          }
        : emptyQuizForm(),
    );
    setQuizModalOpen(true);
  };

  if (isLoading) {
    return <PageAccessGuard pageSlug={PAGE_SLUG}><Group justify="center" py="xl"><Loader /></Group></PageAccessGuard>;
  }

  if (isError || !data) {
    return <PageAccessGuard pageSlug={PAGE_SLUG}><Alert color="red">{formatError(error)}</Alert></PageAccessGuard>;
  }

  const policyEntries = data.entries.filter((entry) => entry.requiresAcknowledgement);
  const availableViews = data.canManage
    ? [
        { label: "Knowledge", value: "knowledge" },
        { label: "Quizzes", value: "quizzes" },
        { label: "Policies", value: "policies" },
        { label: "Admin", value: "admin" },
      ]
    : [
        { label: "Knowledge", value: "knowledge" },
        { label: "Quizzes", value: "quizzes" },
        { label: "Policies", value: "policies" },
      ];

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" align="start">
            <div>
              <Title order={2}>Cerebro</Title>
              <Text c="dimmed">
                OmniLodge operational knowledge, onboarding quizzes, and policy acknowledgements.
              </Text>
            </div>
            <Group gap="sm">
              <Badge variant="light">Articles {data.entries.length}</Badge>
              <Badge variant="light" color="orange">Quizzes {data.quizzes.length}</Badge>
              <Badge variant="light" color="teal">Policies {policyEntries.length}</Badge>
            </Group>
          </Group>
        </Card>

        {feedback ? <Alert color="green">{feedback}</Alert> : null}
        {errorMessage ? <Alert color="red">{errorMessage}</Alert> : null}

        <Card withBorder radius="md" p="lg">
          <Group justify="space-between" align="end">
            <SegmentedControl value={view} onChange={(value) => setView(value as ViewMode)} data={availableViews} />
            {view === "knowledge" ? (
              <Group gap="sm">
                <TextInput placeholder="Search articles" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} />
                <Select data={sectionOptions} value={sectionFilter} onChange={setSectionFilter} allowDeselect={false} />
              </Group>
            ) : null}
          </Group>
        </Card>

        {view === "knowledge" ? (
          <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group gap="xs">
                  <IconFileText size={16} />
                  <Text fw={600}>Articles</Text>
                </Group>
                <ScrollArea h={600}>
                  <Stack gap="xs">
                    {filteredEntries.length === 0 ? <Text c="dimmed" size="sm">No matching articles.</Text> : null}
                    {filteredEntries.map((entry) => (
                      <Paper
                        key={entry.id}
                        withBorder
                        p="sm"
                        radius="md"
                        style={{ cursor: "pointer", borderColor: entry.id === selectedEntryId ? "var(--mantine-color-blue-5)" : undefined }}
                        onClick={() => setSelectedEntryId(entry.id)}
                      >
                        <Group justify="space-between" align="start">
                          <div>
                            <Text fw={600}>{entry.title}</Text>
                            {entry.summary ? <Text size="sm" c="dimmed" lineClamp={2}>{entry.summary}</Text> : null}
                          </div>
                          <Badge variant="light">{entry.kind}</Badge>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Card>

            <Card withBorder radius="md" p="lg" style={{ gridColumn: "span 2" }}>
              {selectedEntry ? (
                <Stack gap="md">
                  <Group justify="space-between" align="start">
                    <div>
                      <Title order={3}>{selectedEntry.title}</Title>
                      <Group gap="xs" mt={4}>
                        <Badge variant="light">{selectedEntry.kind}</Badge>
                        {selectedEntry.category ? <Badge variant="outline">{selectedEntry.category}</Badge> : null}
                        {selectedEntry.estimatedReadMinutes ? <Badge variant="outline">{selectedEntry.estimatedReadMinutes} min</Badge> : null}
                      </Group>
                    </div>
                    {data.canManage ? <Button variant="light" onClick={() => openEntryEditor(selectedEntry)}>Edit</Button> : null}
                  </Group>
                  {selectedEntry.summary ? <Alert color="blue">{selectedEntry.summary}</Alert> : null}
                  <Text style={{ whiteSpace: "pre-wrap" }}>{selectedEntry.body}</Text>
                  {selectedEntry.checklistItems.length > 0 ? (
                    <Card withBorder radius="md" p="md">
                      <Group gap="xs" mb="xs">
                        <IconChecklist size={16} />
                        <Text fw={600}>Checklist</Text>
                      </Group>
                      {selectedEntry.checklistItems.map((item) => <Text key={item} size="sm">• {item}</Text>)}
                    </Card>
                  ) : null}
                  {selectedEntry.media.length > 0 ? (
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                      {selectedEntry.media.map((item, index) => (
                        <Card key={`${item.url}-${index}`} withBorder radius="md" p="sm">
                          <Image src={item.url} alt={item.alt ?? selectedEntry.title} radius="md" />
                          {item.caption ? <Text size="sm" c="dimmed" mt="xs">{item.caption}</Text> : null}
                        </Card>
                      ))}
                    </SimpleGrid>
                  ) : null}
                </Stack>
              ) : (
                <Text c="dimmed">Select an article to view it.</Text>
              )}
            </Card>
          </SimpleGrid>
        ) : null}

        {view === "quizzes" ? (
          <Stack gap="md">
            {data.quizzes.map((quiz) => {
              const latestAttempt = latestAttemptByQuizId.get(quiz.id);
              const answers = quizDrafts[quiz.id] ?? {};
              return (
                <Card key={quiz.id} withBorder radius="md" p="lg">
                  <Stack gap="md">
                    <Group justify="space-between" align="start">
                      <div>
                        <Title order={4}>{quiz.title}</Title>
                        {quiz.description ? <Text c="dimmed">{quiz.description}</Text> : null}
                      </div>
                      <Group gap="xs">
                        <Badge variant="light">Pass {quiz.passingScore}%</Badge>
                        {latestAttempt ? <Badge color={latestAttempt.passed ? "teal" : "orange"} variant="light">{latestAttempt.scorePercent.toFixed(0)}%</Badge> : null}
                        {data.canManage ? <Button variant="light" size="xs" onClick={() => openQuizEditor(quiz)}>Edit</Button> : null}
                      </Group>
                    </Group>
                    {quiz.questions.map((question) => (
                      <Card key={question.id} withBorder radius="md" p="md">
                        <Text fw={600} mb="xs">{question.prompt}</Text>
                        <Radio.Group
                          value={answers[question.id] ?? ""}
                          onChange={(value) => setQuizDrafts((prev) => ({ ...prev, [quiz.id]: { ...(prev[quiz.id] ?? {}), [question.id]: value } }))}
                        >
                          <Stack gap={6}>
                            {question.options.map((option) => <Radio key={option.id} value={option.id} label={option.label} />)}
                          </Stack>
                        </Radio.Group>
                      </Card>
                    ))}
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        {latestAttempt ? `Last submitted ${new Date(latestAttempt.submittedAt).toLocaleString()}` : "Not submitted yet"}
                      </Text>
                      <Button onClick={() => submitQuizMutation.mutate({ quizId: quiz.id, answers })} loading={submitQuizMutation.isPending}>
                        Submit quiz
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              );
            })}
            {data.quizzes.length === 0 ? <Card withBorder radius="md" p="xl"><Text c="dimmed">No quizzes assigned yet.</Text></Card> : null}
          </Stack>
        ) : null}

        {view === "policies" ? (
          <Stack gap="md">
            {policyEntries.map((entry) => {
              const acknowledgement = acknowledgementByEntryId.get(entry.id);
              const requiredVersion = entry.policyVersion ?? "";
              const accepted = acknowledgement != null && (requiredVersion.length === 0 || acknowledgement.versionAccepted === requiredVersion);
              return (
                <Card key={entry.id} withBorder radius="md" p="lg">
                  <Stack gap="md">
                    <Group justify="space-between" align="start">
                      <div>
                        <Group gap="xs">
                          <IconShieldCheck size={16} />
                          <Title order={4}>{entry.title}</Title>
                        </Group>
                        {entry.summary ? <Text c="dimmed">{entry.summary}</Text> : null}
                      </div>
                      <Badge color={accepted ? "teal" : "orange"} variant="light">{accepted ? "Accepted" : "Pending"}</Badge>
                    </Group>
                    <Text style={{ whiteSpace: "pre-wrap" }}>{entry.body}</Text>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        {accepted && acknowledgement ? `Accepted ${new Date(acknowledgement.acceptedAt).toLocaleString()}` : `Version ${entry.policyVersion ?? "current"}`}
                      </Text>
                      <Button disabled={accepted} loading={acknowledgeMutation.isPending} onClick={() => acknowledgeMutation.mutate(entry.id)}>
                        {accepted ? "Accepted" : "Accept policy"}
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              );
            })}
            {policyEntries.length === 0 ? <Card withBorder radius="md" p="xl"><Text c="dimmed">No policies require acknowledgement right now.</Text></Card> : null}
          </Stack>
        ) : null}
        {view === "admin" && data.canManage ? (
          <Stack gap="md">
            <Card withBorder radius="md" p="lg">
              <Group justify="space-between">
                <Text fw={600}>Admin</Text>
                <Group gap="sm">
                  <Button leftSection={<IconPlus size={16} />} variant="light" onClick={() => openSectionEditor()}>Section</Button>
                  <Button leftSection={<IconPlus size={16} />} variant="light" onClick={() => openEntryEditor()}>Article</Button>
                  <Button leftSection={<IconPlus size={16} />} variant="light" onClick={() => openQuizEditor()}>Quiz</Button>
                </Group>
              </Group>
            </Card>
            <SimpleGrid cols={{ base: 1, xl: 3 }} spacing="md">
              <Card withBorder radius="md" p="md">
                <Title order={4}>Sections</Title>
                <Divider my="sm" />
                <Stack gap="xs">
                  {data.sections.map((section) => (
                    <Paper key={section.id} withBorder p="sm" radius="md">
                      <Group justify="space-between" align="start">
                        <div>
                          <Text fw={600}>{section.name}</Text>
                          {section.description ? <Text size="sm" c="dimmed">{section.description}</Text> : null}
                        </div>
                        <Button size="xs" variant="subtle" onClick={() => openSectionEditor(section)}>Edit</Button>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Card>
              <Card withBorder radius="md" p="md">
                <Title order={4}>Articles</Title>
                <Divider my="sm" />
                <Stack gap="xs">
                  {data.entries.map((entry) => (
                    <Paper key={entry.id} withBorder p="sm" radius="md">
                      <Group justify="space-between" align="start">
                        <div>
                          <Text fw={600}>{entry.title}</Text>
                          <Badge variant="light" mt={4}>{entry.kind}</Badge>
                        </div>
                        <Button size="xs" variant="subtle" onClick={() => openEntryEditor(entry)}>Edit</Button>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Card>
              <Card withBorder radius="md" p="md">
                <Title order={4}>Quizzes</Title>
                <Divider my="sm" />
                <Stack gap="xs">
                  {data.quizzes.map((quiz) => (
                    <Paper key={quiz.id} withBorder p="sm" radius="md">
                      <Group justify="space-between" align="start">
                        <div>
                          <Text fw={600}>{quiz.title}</Text>
                          <Text size="sm" c="dimmed">{quiz.questions.length} questions</Text>
                        </div>
                        <Button size="xs" variant="subtle" onClick={() => openQuizEditor(quiz)}>Edit</Button>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Card>
            </SimpleGrid>
          </Stack>
        ) : null}
      </Stack>
      <Modal opened={sectionModalOpen} onClose={() => setSectionModalOpen(false)} title={sectionForm.id ? "Edit section" : "Create section"} centered>
        <Stack gap="sm">
          <TextInput label="Name" value={sectionForm.name} onChange={(event) => setSectionForm((prev) => ({ ...prev, name: event.currentTarget.value }))} />
          <TextInput label="Slug" value={sectionForm.slug} onChange={(event) => setSectionForm((prev) => ({ ...prev, slug: event.currentTarget.value }))} />
          <TextInput label="Description" value={sectionForm.description} onChange={(event) => setSectionForm((prev) => ({ ...prev, description: event.currentTarget.value }))} />
          <TextInput label="Sort order" value={sectionForm.sortOrder} onChange={(event) => setSectionForm((prev) => ({ ...prev, sortOrder: event.currentTarget.value }))} />
          <Switch label="Active" checked={sectionForm.status} onChange={(event) => setSectionForm((prev) => ({ ...prev, status: event.currentTarget.checked }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSectionModalOpen(false)}>Cancel</Button>
            <Button onClick={() => sectionMutation.mutate()} loading={sectionMutation.isPending}>Save</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={entryModalOpen} onClose={() => setEntryModalOpen(false)} title={entryForm.id ? "Edit article" : "Create article"} centered size="lg">
        <Stack gap="sm">
          <Select label="Section" data={sectionOptions.filter((item) => item.value !== "all")} value={entryForm.sectionId} onChange={(value) => setEntryForm((prev) => ({ ...prev, sectionId: value }))} />
          <TextInput label="Title" value={entryForm.title} onChange={(event) => setEntryForm((prev) => ({ ...prev, title: event.currentTarget.value }))} />
          <TextInput label="Slug" value={entryForm.slug} onChange={(event) => setEntryForm((prev) => ({ ...prev, slug: event.currentTarget.value }))} />
          <TextInput label="Category" value={entryForm.category} onChange={(event) => setEntryForm((prev) => ({ ...prev, category: event.currentTarget.value }))} />
          <Select label="Kind" value={entryForm.kind} data={[{ value: "faq", label: "FAQ" }, { value: "tutorial", label: "Tutorial" }, { value: "playbook", label: "Playbook" }, { value: "policy", label: "Policy" }]} onChange={(value) => setEntryForm((prev) => ({ ...prev, kind: (value as EntryKind) ?? "faq" }))} />
          <Textarea label="Summary" minRows={2} value={entryForm.summary} onChange={(event) => setEntryForm((prev) => ({ ...prev, summary: event.currentTarget.value }))} />
          <Textarea label="Body" minRows={8} value={entryForm.body} onChange={(event) => setEntryForm((prev) => ({ ...prev, body: event.currentTarget.value }))} />
          <Textarea label="Media lines" description="One per line: image|https://...|Caption" minRows={3} value={entryForm.mediaLines} onChange={(event) => setEntryForm((prev) => ({ ...prev, mediaLines: event.currentTarget.value }))} />
          <Textarea label="Checklist lines" description="One item per line" minRows={3} value={entryForm.checklistLines} onChange={(event) => setEntryForm((prev) => ({ ...prev, checklistLines: event.currentTarget.value }))} />
          <MultiSelect label="Target roles" data={roleOptions} value={entryForm.targetUserTypeIds} onChange={(value) => setEntryForm((prev) => ({ ...prev, targetUserTypeIds: value }))} searchable clearable />
          <SimpleGrid cols={2}>
            <TextInput label="Policy version" value={entryForm.policyVersion} onChange={(event) => setEntryForm((prev) => ({ ...prev, policyVersion: event.currentTarget.value }))} />
            <TextInput label="Read minutes" value={entryForm.estimatedReadMinutes} onChange={(event) => setEntryForm((prev) => ({ ...prev, estimatedReadMinutes: event.currentTarget.value }))} />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <TextInput label="Sort order" value={entryForm.sortOrder} onChange={(event) => setEntryForm((prev) => ({ ...prev, sortOrder: event.currentTarget.value }))} />
            <Switch label="Requires acknowledgement" checked={entryForm.requiresAcknowledgement} onChange={(event) => setEntryForm((prev) => ({ ...prev, requiresAcknowledgement: event.currentTarget.checked }))} mt="xl" />
          </SimpleGrid>
          <Switch label="Active" checked={entryForm.status} onChange={(event) => setEntryForm((prev) => ({ ...prev, status: event.currentTarget.checked }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEntryModalOpen(false)}>Cancel</Button>
            <Button onClick={() => entryMutation.mutate()} loading={entryMutation.isPending}>Save</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={quizModalOpen} onClose={() => setQuizModalOpen(false)} title={quizForm.id ? "Edit quiz" : "Create quiz"} centered size="lg">
        <Stack gap="sm">
          <Select label="Linked article" data={entryOptions} value={quizForm.entryId} onChange={(value) => setQuizForm((prev) => ({ ...prev, entryId: value }))} searchable clearable />
          <TextInput label="Title" value={quizForm.title} onChange={(event) => setQuizForm((prev) => ({ ...prev, title: event.currentTarget.value }))} />
          <TextInput label="Slug" value={quizForm.slug} onChange={(event) => setQuizForm((prev) => ({ ...prev, slug: event.currentTarget.value }))} />
          <Textarea label="Description" minRows={2} value={quizForm.description} onChange={(event) => setQuizForm((prev) => ({ ...prev, description: event.currentTarget.value }))} />
          <MultiSelect label="Target roles" data={roleOptions} value={quizForm.targetUserTypeIds} onChange={(value) => setQuizForm((prev) => ({ ...prev, targetUserTypeIds: value }))} searchable clearable />
          <SimpleGrid cols={2}>
            <TextInput label="Passing score" value={quizForm.passingScore} onChange={(event) => setQuizForm((prev) => ({ ...prev, passingScore: event.currentTarget.value }))} />
            <TextInput label="Sort order" value={quizForm.sortOrder} onChange={(event) => setQuizForm((prev) => ({ ...prev, sortOrder: event.currentTarget.value }))} />
          </SimpleGrid>
          <Textarea label="Questions JSON" minRows={10} value={quizForm.questionsJson} onChange={(event) => setQuizForm((prev) => ({ ...prev, questionsJson: event.currentTarget.value }))} />
          <Switch label="Active" checked={quizForm.status} onChange={(event) => setQuizForm((prev) => ({ ...prev, status: event.currentTarget.checked }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setQuizModalOpen(false)}>Cancel</Button>
            <Button onClick={() => quizMutation.mutate()} loading={quizMutation.isPending}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default Cerebro;
