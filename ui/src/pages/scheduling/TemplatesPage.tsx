import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
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
import { useShiftRoles } from "../../api/shiftRoles";
import { useAppSelector } from "../../store/hooks";
import { makeSelectIsModuleActionAllowed } from "../../selectors/accessControlSelectors";
import type { ShiftTemplate, ShiftTemplateRoleRequirement } from "../../types/scheduling";
import type { ShiftRole } from "../../types/shiftRoles/ShiftRole";

type RoleEntry = {
  id: string;
  roleId: string | null;
  customName: string;
  required: number;
};

type TemplateFormState = {
  id?: number;
  name: string;
  shiftTypeId: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultCapacity?: number;
  requiresLeader: boolean;
  roleEntries: RoleEntry[];
  defaultMeta: string;
  repeatOn: number[];
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

const ALL_WEEKDAYS = WEEKDAY_OPTIONS.map((option) => option.value);

const emptyForm: TemplateFormState = {
  name: "",
  shiftTypeId: "",
  defaultStartTime: "",
  defaultEndTime: "",
  defaultCapacity: undefined,
  requiresLeader: false,
  roleEntries: [],
  defaultMeta: "",
  repeatOn: [...ALL_WEEKDAYS],
};

let roleEntryCounter = 0;
const createRoleEntryId = () => `role-${roleEntryCounter++}`;

const TemplatesPage = () => {
  const selectCanManage = useMemo(
    () => makeSelectIsModuleActionAllowed("scheduling-builder", "create"),
    [],
  );
  const canManageTemplates = useAppSelector(selectCanManage);

  const shiftTypesQuery = useShiftTypes({ enabled: canManageTemplates });
  const shiftRolesQuery = useShiftRoles();
  const templatesQuery = useShiftTemplates({ enabled: canManageTemplates });
  const upsertTemplate = useUpsertShiftTemplate();
  const deleteTemplate = useDeleteShiftTemplate();

  const [modalOpen, setModalOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>({ ...emptyForm, repeatOn: [...ALL_WEEKDAYS] });
  const [formError, setFormError] = useState<string | null>(null);

  const shiftTypes = useMemo(() => shiftTypesQuery.data ?? [], [shiftTypesQuery.data]);
  const shiftRoleRecords = useMemo(() => (shiftRolesQuery.data?.[0]?.data ?? []) as ShiftRole[], [shiftRolesQuery.data]);
  const shiftRoleOptions = useMemo(
    () => shiftRoleRecords.map((role) => ({ value: role.id.toString(), label: role.name })),
    [shiftRoleRecords],
  );
  const roleSelectOptions = useMemo(
    () => [{ value: "__custom__", label: "Custom role" }, ...shiftRoleOptions],
    [shiftRoleOptions],
  );
  const templates = templatesQuery.data ?? [];

  const shiftTypeOptions = useMemo(
    () => shiftTypes.map((type) => ({ value: type.id.toString(), label: type.name })),
    [shiftTypes],
  );

  const handleOpenCreate = () => {
    setFormState({ ...emptyForm, repeatOn: [...ALL_WEEKDAYS] });
    setFormError(null);
    setModalOpen(true);
  };

  const mapTemplateRolesToEntries = (template: ShiftTemplate): RoleEntry[] =>
    (template.defaultRoles ?? []).map((definition) => ({
      id: createRoleEntryId(),
      roleId: definition.shiftRoleId != null ? definition.shiftRoleId.toString() : null,
      customName: definition.role ?? "",
      required: Math.max(1, definition.required ?? 1),
    }));

  const handleOpenEdit = (template: ShiftTemplate) => {
    setFormState({
      id: template.id,
      name: template.name,
      shiftTypeId: template.shiftTypeId.toString(),
      defaultStartTime: template.defaultStartTime ?? "",
      defaultEndTime: template.defaultEndTime ?? "",
      defaultCapacity: template.defaultCapacity ?? undefined,
      requiresLeader: template.requiresLeader ?? false,
      roleEntries: mapTemplateRolesToEntries(template),
      defaultMeta: template.defaultMeta ? JSON.stringify(template.defaultMeta, null, 2) : "",
      repeatOn: (template.repeatOn && template.repeatOn.length > 0
        ? [...template.repeatOn].sort((a, b) => a - b)
        : [...ALL_WEEKDAYS]),
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    if (upsertTemplate.isPending) return;
    setModalOpen(false);
    setFormState({ ...emptyForm, repeatOn: [...ALL_WEEKDAYS] });
    setFormError(null);
  };

  const handleAddRoleEntry = () => {
    const defaultOption = shiftRoleOptions[0];
    setFormState((state) => ({
      ...state,
      roleEntries: [
        ...state.roleEntries,
        {
          id: createRoleEntryId(),
          roleId: defaultOption ? defaultOption.value : null,
          customName: defaultOption ? defaultOption.label : "",
          required: 1,
        },
      ],
    }));
  };

  const handleRoleSelectionChange = (entryId: string, value: string | null) => {
    setFormState((state) => ({
      ...state,
      roleEntries: state.roleEntries.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }
        if (!value || value === "__custom__") {
          return { ...entry, roleId: null };
        }
        const numericId = Number(value);
        const reference = shiftRoleRecords.find((role) => role.id === numericId);
        return { ...entry, roleId: value, customName: reference?.name ?? entry.customName };
      }),
    }));
  };

  const handleRoleCustomNameChange = (entryId: string, value: string) => {
    setFormState((state) => ({
      ...state,
      roleEntries: state.roleEntries.map((entry) =>
        entry.id === entryId ? { ...entry, customName: value } : entry,
      ),
    }));
  };

  const handleRoleRequiredChange = (entryId: string, value: string | number) => {
    const numeric = typeof value === "number" ? value : Number(value);
    setFormState((state) => ({
      ...state,
      roleEntries: state.roleEntries.map((entry) =>
        entry.id === entryId ? { ...entry, required: Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : 1 } : entry,
      ),
    }));
  };

  const handleRemoveRoleEntry = (entryId: string) => {
    setFormState((state) => ({
      ...state,
      roleEntries: state.roleEntries.filter((entry) => entry.id !== entryId),
    }));
  };

  const handleRepeatOnChange = (values: string[]) => {
    const cleaned = Array.from(
      new Set(
        values
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
      ),
    ).sort((a, b) => a - b);
    setFormState((state) => ({
      ...state,
      repeatOn: cleaned,
    }));
  };

  const handleSubmit = async () => {
    if (!formState.name.trim() || !formState.shiftTypeId) {
      setFormError("Name and shift type are required.");
      return;
    }
    if (formState.repeatOn.length === 0) {
      setFormError("Select at least one weekday for this template.");
      return;
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

    let hasInvalidCustomName = false;
    const defaultRoles: ShiftTemplateRoleRequirement[] = formState.roleEntries
      .map((entry) => {
        const required = Number.isFinite(entry.required) ? Math.max(1, entry.required) : 1;
        if (entry.roleId) {
          const numericId = Number(entry.roleId);
          const reference = shiftRoleRecords.find((role) => role.id === numericId);
          return {
            shiftRoleId: Number.isInteger(numericId) ? numericId : null,
            role: reference?.name ?? entry.customName ?? "",
            required,
          };
        }
        const customName = entry.customName.trim();
        if (customName.length === 0) {
          hasInvalidCustomName = true;
          return null;
        }
        return {
          shiftRoleId: null,
          role: customName,
          required,
        };
      })
      .filter(Boolean) as ShiftTemplateRoleRequirement[];

    if (hasInvalidCustomName) {
      setFormError("Please provide a role name for each custom role entry.");
      return;
    }

    try {
      await upsertTemplate.mutateAsync({
        id: formState.id,
        name: formState.name.trim(),
        shiftTypeId: Number(formState.shiftTypeId),
        defaultStartTime: formState.defaultStartTime ? formState.defaultStartTime.trim() : null,
        defaultEndTime: formState.defaultEndTime ? formState.defaultEndTime.trim() : null,
        defaultCapacity: formState.defaultCapacity ?? null,
        requiresLeader: formState.requiresLeader,
        defaultRoles: defaultRoles.length ? defaultRoles : null,
        defaultMeta: parsedMeta ? (parsedMeta as Record<string, unknown>) : null,
        repeatOn: formState.repeatOn.slice(),
      });
      handleCloseModal();
    } catch (error) {
      setFormError((error as Error).message);
    }
  };

  const rows = templates.map((template) => {
    const shiftType = shiftTypes.find((type) => type.id === template.shiftTypeId);
    return (
      <Table.Tr key={template.id}>
        <Table.Td>{template.name}</Table.Td>
        <Table.Td>{shiftType?.name ?? ""}</Table.Td>
        <Table.Td>{template.defaultStartTime ?? "—"}</Table.Td>
        <Table.Td>{template.defaultEndTime ?? "—"}</Table.Td>
        <Table.Td>{template.defaultCapacity ?? "—"}</Table.Td>
        <Table.Td>{template.requiresLeader ? "Yes" : "No"}</Table.Td>
        <Table.Td>
          <Group gap="xs">
            <ActionIcon variant="light" color="blue" onClick={() => handleOpenEdit(template)}>
              <IconEdit size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={async () => {
                await deleteTemplate.mutateAsync(template.id);
              }}
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
          <Checkbox.Group
            label="Auto-generate on"
            value={formState.repeatOn.map((day) => day.toString())}
            onChange={handleRepeatOnChange}
            withAsterisk
          >
            <Group gap="sm">
              {WEEKDAY_OPTIONS.map((option) => (
                <Checkbox key={option.value} value={option.value.toString()} label={option.label} />
              ))}
            </Group>
          </Checkbox.Group>

          {shiftRolesQuery.isError ? (
            <Alert color="red" title="Shift roles unavailable">
              {(shiftRolesQuery.error as Error).message}
            </Alert>
          ) : null}

          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text fw={500}>Default roles</Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={handleAddRoleEntry}
                disabled={shiftRolesQuery.isLoading}
              >
                Add role
              </Button>
            </Group>
            {formState.roleEntries.length ? (
              formState.roleEntries.map((entry) => (
                <Group key={entry.id} align="flex-end" gap="sm">
                  <Select
                    label="Role"
                    data={roleSelectOptions}
                    value={entry.roleId ?? "__custom__"}
                    onChange={(value) => handleRoleSelectionChange(entry.id, value)}
                    flex={1}
                    comboboxProps={{ withinPortal: true }}
                  />
                  {entry.roleId === null ? (
                    <TextInput
                      label="Custom role name"
                      placeholder="Enter role name"
                      value={entry.customName}
                      onChange={(event) => handleRoleCustomNameChange(entry.id, event.currentTarget.value)}
                      flex={1}
                      required
                    />
                  ) : null}
                  <NumberInput
                    label="Required"
                    min={1}
                    value={entry.required}
                    onChange={(value) => handleRoleRequiredChange(entry.id, value)}
                    allowNegative={false}
                    allowDecimal={false}
                    hideControls
                    style={{ width: 120 }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => handleRemoveRoleEntry(entry.id)}
                    aria-label="Remove role"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                No default roles configured. {shiftRoleRecords.length ? "Use \"Add role\" to define required slots." : "Create shift roles in Settings first."}
              </Text>
            )}
          </Stack>

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

