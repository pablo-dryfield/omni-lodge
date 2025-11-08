import { useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Box,
  Badge,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAdjustments, IconDeviceFloppy, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import {
  useReportTemplates,
  useDerivedFields,
  useCreateDerivedField,
  useUpdateDerivedField,
  useDeleteDerivedField,
  type DerivedFieldDto,
  type DerivedFieldExpressionAst,
} from "../api/reports";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";

type DerivedFieldDraft = {
  id?: string;
  name: string;
  expression: string;
  kind: "row" | "aggregate";
  scope: "workspace" | "template";
  templateId: string | null;
  metadata: Record<string, unknown>;
  expressionAst?: DerivedFieldExpressionAst | null;
};

const DEFAULT_DRAFT: DerivedFieldDraft = {
  name: "",
  expression: "",
  kind: "row",
  scope: "workspace",
  templateId: null,
  metadata: {},
  expressionAst: null,
};

const mapDtoToDraft = (field: DerivedFieldDto): DerivedFieldDraft => ({
  id: field.id,
  name: field.name,
  expression: field.expression,
  kind: field.kind,
  scope: field.scope,
  templateId: field.templateId,
  metadata: field.metadata ?? {},
  expressionAst: field.expressionAst ?? null,
});

const DerivedFieldsManager = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  useEffect(() => {
    dispatch(navigateToPage(title ?? "Derived fields"));
  }, [dispatch, title]);

  const templatesQuery = useReportTemplates();
  const templates = templatesQuery.data?.templates ?? [];
  const templateOptions = useMemo(
    () =>
      templates.map((template) => ({
        value: template.id,
        label: template.name ?? "Untitled template",
      })),
    [templates],
  );

  const [scopeFilter, setScopeFilter] = useState<"workspace" | "template" | "all">("all");
  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search.trim().toLowerCase(), 200);

  const derivedFieldsQuery = useDerivedFields(templateFilter ?? undefined);
  const derivedFields = derivedFieldsQuery.data?.derivedFields ?? [];
  const filteredFields = useMemo(() => {
    return derivedFields.filter((field) => {
      if (scopeFilter !== "all" && field.scope !== scopeFilter) {
        return false;
      }
      if (templateFilter && field.templateId !== templateFilter) {
        return false;
      }
      const haystack = [
        field.name,
        field.expression,
        field.scope,
        field.templateId ?? "",
      ]
        .map((value) => value.toLowerCase())
        .join(" ");
      return debouncedSearch.length === 0 || haystack.includes(debouncedSearch);
    });
  }, [debouncedSearch, derivedFields, scopeFilter, templateFilter]);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DerivedFieldDraft>(DEFAULT_DRAFT);
  const [isEditing, setIsEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const createMutation = useCreateDerivedField();
  const updateMutation = useUpdateDerivedField();
  const deleteMutation = useDeleteDerivedField();

  const handleOpenCreate = () => {
    setDraft(DEFAULT_DRAFT);
    setIsEditing(false);
    setModalOpen(true);
    setFeedback(null);
  };

  const handleOpenEdit = (field: DerivedFieldDto) => {
    setDraft(mapDtoToDraft(field));
    setIsEditing(true);
    setModalOpen(true);
    setFeedback(null);
  };

  const handleDelete = async (field: DerivedFieldDto) => {
    if (!window.confirm(`Delete derived field "${field.name}"? This cannot be undone.`)) {
      return;
    }
    setFeedback(null);
    try {
      await deleteMutation.mutateAsync(field.id);
      queryClient.invalidateQueries({ queryKey: ["reports", "derived-fields"] });
      setFeedback({ type: "success", message: "Derived field deleted." });
    } catch (error) {
      console.error("Failed to delete derived field", error);
      setFeedback({ type: "error", message: "Failed to delete derived field." });
    }
  };

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.expression.trim()) {
      setFeedback({ type: "error", message: "Name and expression are required." });
      return;
    }
    if (draft.scope === "template" && (!draft.templateId || draft.templateId.trim().length === 0)) {
      setFeedback({ type: "error", message: "Select a template for template-scoped derived fields." });
      return;
    }

    const payload = {
      name: draft.name.trim(),
      expression: draft.expression.trim(),
      kind: draft.kind,
      scope: draft.scope,
      templateId: draft.scope === "template" ? draft.templateId ?? null : null,
      metadata: draft.metadata,
      expressionAst: draft.expressionAst ?? null,
    };

    setFeedback(null);
    try {
      if (isEditing && draft.id) {
        await updateMutation.mutateAsync({ id: draft.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      queryClient.invalidateQueries({ queryKey: ["reports", "derived-fields"] });
      setModalOpen(false);
      setFeedback({ type: "success", message: isEditing ? "Derived field updated." : "Derived field created." });
    } catch (error) {
      console.error("Failed to save derived field", error);
      setFeedback({ type: "error", message: "Failed to save derived field." });
    }
  };

  const busy = derivedFieldsQuery.isLoading || templatesQuery.isLoading;

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reports}>
      <Box bg="#f4f6f8" p="xl" style={{ minHeight: "100vh" }}>
        <Stack gap="xl">
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs">
              <Title order={2}>Derived field library</Title>
              <Text c="dimmed">
                Define reusable expressions to enrich report templates. Derived fields can be scoped globally or to a
                specific template.
              </Text>
            </Stack>
            <Group gap="sm">
              <Button
                variant="light"
                leftSection={<IconAdjustments size={16} />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ["reports", "derived-fields"] })}
              >
                Refresh
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>
                New derived field
              </Button>
            </Group>
          </Group>

          {feedback && (
            <Text c={feedback.type === "success" ? "teal" : "red"}>{feedback.message}</Text>
          )}

          <Flex gap="lg" align="flex-start" direction={{ base: "column", md: "row" }}>
            <Paper withBorder radius="lg" p="md" shadow="xs" style={{ width: 320, flexShrink: 0 }}>
              <Stack gap="sm">
                <TextInput
                  placeholder="Search derived fields"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  leftSection={<IconSearch size={14} />}
                  size="sm"
                />
                <Divider />
                <Select
                  label="Scope"
                  data={[
                    { value: "all", label: "All scopes" },
                    { value: "workspace", label: "Workspace" },
                    { value: "template", label: "Template" },
                  ]}
                  value={scopeFilter}
                  onChange={(value) => setScopeFilter((value as typeof scopeFilter | null) ?? "all")}
                />
                <Select
                  label="Template"
                  data={[{ value: "", label: "All templates" }, ...templateOptions]}
                  value={templateFilter ?? ""}
                  onChange={(value) => setTemplateFilter(value && value.length > 0 ? value : null)}
                  disabled={scopeFilter === "workspace"}
                />
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="lg" shadow="xs" style={{ flex: 1, width: "100%" }}>
              {busy ? (
                <Stack align="center" gap="xs">
                  <Loader size="sm" />
                  <Text c="dimmed" fz="sm">
                    Loading derived fields...
                  </Text>
                </Stack>
              ) : filteredFields.length === 0 ? (
                <Stack align="center" gap="sm">
                  <Text c="dimmed">
                    {derivedFields.length === 0
                      ? "No derived fields defined yet. Create one to extend your templates."
                      : "No derived fields match your filters."}
                  </Text>
                </Stack>
              ) : (
                <ScrollArea h={520} type="always" offsetScrollbars>
                  <Table stickyHeader verticalSpacing="sm" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Expression</Table.Th>
                        <Table.Th>Scope</Table.Th>
                        <Table.Th>Template</Table.Th>
                        <Table.Th>Updated</Table.Th>
                        <Table.Th align="right">Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredFields.map((field) => {
                        const template = templates.find((candidate) => candidate.id === field.templateId);
                        return (
                          <Table.Tr key={field.id}>
                            <Table.Td>
                              <Text fw={600}>{field.name}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm" c="dimmed" lineClamp={2}>
                                {field.expression}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="light">{field.scope}</Badge>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm">{template?.name ?? field.templateId ?? "-"}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm" c="dimmed">
                                {field.updatedAt ? new Date(field.updatedAt).toLocaleString() : "-"}
                              </Text>
                            </Table.Td>
                            <Table.Td align="right">
                              <Group gap="xs" justify="flex-end">
                                <Button variant="light" size="xs" onClick={() => handleOpenEdit(field)}>
                                  Edit
                                </Button>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  onClick={() => handleDelete(field)}
                                  aria-label="Delete derived field"
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </Paper>
          </Flex>
        </Stack>
      </Box>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditing ? "Edit derived field" : "New derived field"}
        size="lg"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
            placeholder="Revenue per booking"
            required
          />
          <Textarea
            label="Expression"
            value={draft.expression}
            onChange={(event) => setDraft((current) => ({ ...current, expression: event.currentTarget.value }))}
            minRows={4}
            placeholder="(revenue - costs)"
            required
          />
          <Flex gap="lg" align="flex-end" wrap="wrap">
            <Select
              label="Kind"
              data={[
                { value: "row", label: "Row level" },
                { value: "aggregate", label: "Aggregate" },
              ]}
              value={draft.kind}
              onChange={(value) =>
                setDraft((current) => ({ ...current, kind: (value as "row" | "aggregate" | null) ?? current.kind }))
              }
              style={{ minWidth: 160 }}
            />
            <Select
              label="Scope"
              data={[
                { value: "workspace", label: "Workspace (available to all templates)" },
                { value: "template", label: "Template specific" },
              ]}
              value={draft.scope}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  scope: (value as "workspace" | "template" | null) ?? current.scope,
                  templateId: value === "template" ? current.templateId : null,
                }))
              }
              style={{ minWidth: 220 }}
            />
            {draft.scope === "template" && (
              <Select
                label="Template"
                data={templateOptions}
                value={draft.templateId ?? null}
                onChange={(value) => setDraft((current) => ({ ...current, templateId: value ?? null }))}
                placeholder="Select template"
                searchable
                required
                style={{ minWidth: 240 }}
              />
            )}
            <Switch
              label="Mark as advanced"
              checked={Boolean(draft.metadata?.advanced)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  metadata: { ...current.metadata, advanced: event.currentTarget.checked },
                }))
              }
            />
          </Flex>
          <Group justify="flex-end" gap="sm">
            <Button variant="light" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button leftSection={<IconDeviceFloppy size={16} />} onClick={handleSave} loading={createMutation.isPending || updateMutation.isPending}>
              {isEditing ? "Save changes" : "Create field"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default DerivedFieldsManager;
