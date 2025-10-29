import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useShiftTemplates, useShiftTypes, useUpsertShiftTemplate, useDeleteShiftTemplate } from "../../api/scheduling";
import { useAppSelector } from "../../store/hooks";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";
import type { ShiftTemplate } from "../../types/scheduling";

type TemplateFormState = {
  id?: number;
  name: string;
  shiftTypeId: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultCapacity?: number;
  requiresLeader: boolean;
  defaultRoles: string;
  defaultMeta: string;
};

const emptyForm: TemplateFormState = {
  name: "",
  shiftTypeId: "",
  defaultStartTime: "",
  defaultEndTime: "",
  defaultCapacity: undefined,
  requiresLeader: false,
  defaultRoles: "",
  defaultMeta: "",
};

const TemplatesPage = () => {
  const selectCanManage = useMemo(
    () => makeSelectIsModuleActionAllowed("scheduling-builder", "create"),
    [],
  );
  const canManageTemplates = useAppSelector(selectCanManage);

  const shiftTypesQuery = useShiftTypes({ enabled: canManageTemplates });
  const templatesQuery = useShiftTemplates({ enabled: canManageTemplates });
  const upsertTemplate = useUpsertShiftTemplate();
  const deleteTemplate = useDeleteShiftTemplate();

  const [modalOpen, setModalOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const shiftTypes = shiftTypesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  const handleOpenCreate = () => {
    setFormState(emptyForm);
    setFormError(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (template: ShiftTemplate) => {
    setFormState({
      id: template.id,
      name: template.name,
      shiftTypeId: template.shiftTypeId.toString(),
      defaultStartTime: template.defaultStartTime ?? "",
      defaultEndTime: template.defaultEndTime ?? "",
      defaultCapacity: template.defaultCapacity ?? undefined,
      requiresLeader: template.requiresLeader ?? false,
      defaultRoles: template.defaultRoles ? JSON.stringify(template.defaultRoles, null, 2) : "",
      defaultMeta: template.defaultMeta ? JSON.stringify(template.defaultMeta, null, 2) : "",
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    if (upsertTemplate.isPending) return;
    setModalOpen(false);
    setFormState(emptyForm);
    setFormError(null);
  };

  const handleSubmit = async () => {
    if (!formState.name.trim() || !formState.shiftTypeId) {
      setFormError("Name and shift type are required.");
      return;
    }

    let parsedRoles: unknown = null;
    if (formState.defaultRoles.trim().length > 0) {
      try {
        parsedRoles = JSON.parse(formState.defaultRoles);
        if (!Array.isArray(parsedRoles)) {
          throw new Error("Default roles must be an array.");
        }
      } catch (error) {
        setFormError((error as Error).message);
        return;
      }
    }

    let parsedMeta: unknown = null;
    if (formState.defaultMeta.trim().length > 0) {
      try {
        parsedMeta = JSON.parse(formState.defaultMeta);
      } catch (error) {
        setFormError("Metadata must be valid JSON.");
        return;
      }
    }

    try {
      await upsertTemplate.mutateAsync({
        id: formState.id,
        name: formState.name.trim(),
        shiftTypeId: Number(formState.shiftTypeId),
        defaultStartTime: formState.defaultStartTime || null,
        defaultEndTime: formState.defaultEndTime || null,
        defaultCapacity: formState.defaultCapacity ?? null,
        requiresLeader: formState.requiresLeader,
        defaultRoles: (parsedRoles as ShiftTemplate["defaultRoles"]) ?? null,
        defaultMeta: (parsedMeta as ShiftTemplate["defaultMeta"]) ?? null,
      });
      handleCloseModal();
    } catch (error) {
      setFormError((error as Error).message);
    }
  };

  const handleDelete = async (template: ShiftTemplate) => {
    const confirmed = window.confirm(`Delete template "${template.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteTemplate.mutateAsync(template.id);
    } catch (error) {
      // eslint-disable-next-line no-alert
      window.alert((error as Error).message);
    }
  };

  if (!canManageTemplates) {
    return (
      <Stack mt="lg" gap="md">
        <Alert color="yellow" title="Insufficient permissions">
          <Text size="sm">You do not have permission to manage scheduling templates.</Text>
        </Alert>
      </Stack>
    );
  }

  if (templatesQuery.isLoading || shiftTypesQuery.isLoading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (templatesQuery.isError) {
    return (
      <Alert color="red" title="Unable to load templates">
        {(templatesQuery.error as Error).message}
      </Alert>
    );
  }

  if (shiftTypesQuery.isError) {
    return (
      <Alert color="red" title="Unable to load shift types">
        {(shiftTypesQuery.error as Error).message}
      </Alert>
    );
  }

  const shiftTypeOptions = shiftTypes.map((type) => ({
    value: type.id.toString(),
    label: type.name,
  }));

  const rows = templates.map((template) => {
    const shiftType = shiftTypes.find((type) => type.id === template.shiftTypeId);
    return (
      <Table.Tr key={template.id}>
        <Table.Td>{template.name}</Table.Td>
        <Table.Td>{shiftType?.name ?? `#${template.shiftTypeId}`}</Table.Td>
        <Table.Td>{template.defaultStartTime ?? "—"}</Table.Td>
        <Table.Td>{template.defaultEndTime ?? "—"}</Table.Td>
        <Table.Td>{template.defaultCapacity ?? "—"}</Table.Td>
        <Table.Td>{template.requiresLeader ? "Yes" : "No"}</Table.Td>
        <Table.Td>
          <Group gap="xs" justify="flex-end">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="blue"
              onClick={() => handleOpenEdit(template)}
              aria-label="Edit template"
            >
              <IconEdit size={16} />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={() => handleDelete(template)}
              aria-label="Delete template"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Stack mt="lg" gap="lg">
      <Group justify="space-between">
        <Text fw={600}>Shift templates</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>
          New template
        </Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Shift type</Table.Th>
            <Table.Th>Start</Table.Th>
            <Table.Th>End</Table.Th>
            <Table.Th>Capacity</Table.Th>
            <Table.Th>Requires leader</Table.Th>
            <Table.Th style={{ width: 120 }}>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.length ? (
            rows
          ) : (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text size="sm" c="dimmed" ta="center">
                  No templates yet. Create one to get started.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Modal opened={modalOpen} onClose={handleCloseModal} title={formState.id ? "Edit template" : "New template"} size="lg">
        <Stack>
          {formError ? (
            <Alert color="red" title="Unable to save">
              {formError}
            </Alert>
          ) : null}
          <TextInput
            label="Template name"
            value={formState.name}
            onChange={(event) => setFormState((state) => ({ ...state, name: event.currentTarget.value }))}
            required
          />
          <Select
            label="Shift type"
            placeholder="Select shift type"
            data={shiftTypeOptions}
            value={formState.shiftTypeId}
            onChange={(value) => setFormState((state) => ({ ...state, shiftTypeId: value ?? "" }))}
            required
          />
          <Group grow>
            <TextInput
              label="Default start time (HH:mm)"
              value={formState.defaultStartTime}
              placeholder="08:00"
              onChange={(event) =>
                setFormState((state) => ({ ...state, defaultStartTime: event.currentTarget.value.trim() }))
              }
            />
            <TextInput
              label="Default end time (HH:mm)"
              value={formState.defaultEndTime}
              placeholder="10:00"
              onChange={(event) =>
                setFormState((state) => ({ ...state, defaultEndTime: event.currentTarget.value.trim() }))
              }
            />
          </Group>
          <NumberInput
            label="Default capacity"
            value={formState.defaultCapacity ?? undefined}
            onChange={(value) =>
              setFormState((state) => ({ ...state, defaultCapacity: typeof value === "number" ? value : undefined }))
            }
            min={0}
          />
          <Switch
            label="Requires leader"
            checked={formState.requiresLeader}
            onChange={(event) =>
              setFormState((state) => ({ ...state, requiresLeader: event.currentTarget.checked }))
            }
          />
          <Textarea
            label="Default roles (JSON array)"
            placeholder='Example: [{"role":"Leader","required":1}]'
            minRows={3}
            value={formState.defaultRoles}
            onChange={(event) => setFormState((state) => ({ ...state, defaultRoles: event.currentTarget.value }))}
          />
          <Textarea
            label="Default metadata (JSON object)"
            placeholder='Example: {"location":"Main Hall"}'
            minRows={3}
            value={formState.defaultMeta}
            onChange={(event) => setFormState((state) => ({ ...state, defaultMeta: event.currentTarget.value }))}
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={handleCloseModal} disabled={upsertTemplate.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={upsertTemplate.isPending}>
              {formState.id ? "Save changes" : "Create template"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default TemplatesPage;

