import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { DatePickerInput, TimeInput } from "@mantine/dates";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ShiftInstance, ShiftInstancePayload, ShiftRoleRequirement } from "../../types/scheduling";
import type { ShiftRole } from "../../types/shiftRoles/ShiftRole";

export interface EditShiftInstanceModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (payload: { id: number; data: Partial<ShiftInstancePayload> }) => Promise<void>;
  instance: ShiftInstance | null;
  shiftRoles: ShiftRole[];
}

type RoleEntry = {
  id: string;
  role: string;
  shiftRoleId: number | null;
  required: number | null;
};

const createRoleEntryId = () =>
  `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const EditShiftInstanceModal = ({
  opened,
  onClose,
  onSubmit,
  instance,
  shiftRoles,
}: EditShiftInstanceModalProps) => {
  const [date, setDate] = useState<Date | null>(null);
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [capacity, setCapacity] = useState<number | undefined>(undefined);
  const [meta, setMeta] = useState("");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [roleEntries, setRoleEntries] = useState<RoleEntry[]>([]);
  const [rolesDirty, setRolesDirty] = useState(false);

  const shiftRoleOptions = useMemo(
    () => [
      { value: "custom", label: "Custom role" },
      ...shiftRoles.map((role) => ({ value: role.id.toString(), label: role.name })),
    ],
    [shiftRoles],
  );

  const shiftRoleNameById = useMemo(() => {
    const map = new Map<number, string>();
    shiftRoles.forEach((role) => {
      map.set(role.id, role.name);
    });
    return map;
  }, [shiftRoles]);

  useEffect(() => {
    if (!opened || !instance) {
      return;
    }
    const initialRoles = instance.requiredRoles ?? instance.template?.defaultRoles ?? [];
    setDate(dayjs(instance.date).toDate());
    setTimeStart(instance.timeStart ?? "");
    setTimeEnd(instance.timeEnd ?? "");
    setCapacity(instance.capacity ?? undefined);
    setMeta(instance.meta ? JSON.stringify(instance.meta, null, 2) : "");
    setMetaError(null);
    setRoleEntries(
      initialRoles.map((role) => ({
        id: createRoleEntryId(),
        role: role.role ?? "",
        shiftRoleId: role.shiftRoleId ?? null,
        required: role.required ?? null,
      })),
    );
    setRolesDirty(false);
  }, [instance, opened]);

  const handleRoleEntryChange = (id: string, patch: Partial<RoleEntry>) => {
    setRoleEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
    setRolesDirty(true);
  };

  const handleRoleShiftRoleChange = (id: string, value: string | null) => {
    const nextId = value && value !== "custom" ? Number(value) : null;
    const nextLabel = nextId != null ? shiftRoleNameById.get(nextId) : null;
    setRoleEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }
        const roleLabel = entry.role.trim().length === 0 && nextLabel ? nextLabel : entry.role;
        return { ...entry, shiftRoleId: nextId, role: roleLabel };
      }),
    );
    setRolesDirty(true);
  };

  const handleAddRole = () => {
    setRoleEntries((prev) => [
      ...prev,
      { id: createRoleEntryId(), role: "", shiftRoleId: null, required: null },
    ]);
    setRolesDirty(true);
  };

  const handleRemoveRole = (id: string) => {
    setRoleEntries((prev) => prev.filter((entry) => entry.id !== id));
    setRolesDirty(true);
  };

  const handleSubmit = async () => {
    if (!instance || !date || !timeStart) {
      return;
    }
    setMetaError(null);
    let parsedMeta: Record<string, unknown> | null = null;
    if (meta.trim()) {
      try {
        parsedMeta = JSON.parse(meta);
      } catch {
        setMetaError("Metadata must be valid JSON.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const data: Partial<ShiftInstancePayload> = {
        date: dayjs(date).format("YYYY-MM-DD"),
        timeStart,
        timeEnd: timeEnd ? timeEnd : null,
        capacity: typeof capacity === "number" ? capacity : null,
        meta: parsedMeta,
      };
      if (rolesDirty) {
        const normalizedRoles = roleEntries
          .map((entry) => {
            const trimmedRole = entry.role.trim();
            const roleLabel =
              trimmedRole.length > 0
                ? trimmedRole
                : entry.shiftRoleId != null
                  ? shiftRoleNameById.get(entry.shiftRoleId) ?? ""
                  : "";
            if (!roleLabel) {
              return null;
            }
            return {
              role: roleLabel,
              shiftRoleId: entry.shiftRoleId ?? null,
              required: typeof entry.required === "number" ? entry.required : null,
            } as ShiftRoleRequirement;
          })
          .filter((entry): entry is ShiftRoleRequirement => Boolean(entry));
        data.requiredRoles = normalizedRoles;
      }

      await onSubmit({
        id: instance.id,
        data,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const title = instance?.template?.name ?? instance?.shiftType?.name ?? "Shift";

  return (
    <Modal opened={opened} onClose={onClose} title={`Edit ${title}`} size="lg">
      <Stack>
        <DatePickerInput label="Date" value={date} onChange={setDate} required />
        <Group grow>
          <TimeInput
            label="Start time"
            value={timeStart}
            onChange={(value) => setTimeStart(value ?? "")}
            required
          />
          <TimeInput label="End time" value={timeEnd} onChange={(value) => setTimeEnd(value ?? "")} />
        </Group>
        <NumberInput
          label="Capacity"
          value={capacity ?? undefined}
          onChange={(value) => setCapacity(typeof value === "number" ? value : undefined)}
          min={0}
        />
        <Textarea
          label="Metadata (JSON)"
          value={meta}
          onChange={(event) => {
            setMeta(event.currentTarget.value);
            if (metaError) {
              setMetaError(null);
            }
          }}
          error={metaError}
          minRows={3}
        />
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text fw={600}>Required roles</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={handleAddRole}
            >
              Add role
            </Button>
          </Group>
          {roleEntries.length > 0 ? (
            roleEntries.map((entry) => (
              <Group key={entry.id} align="flex-end" wrap="wrap">
                <Select
                  label="Shift role"
                  data={shiftRoleOptions}
                  value={entry.shiftRoleId != null ? entry.shiftRoleId.toString() : "custom"}
                  onChange={(value) => handleRoleShiftRoleChange(entry.id, value)}
                  placeholder="Select role"
                  w={200}
                />
                <TextInput
                  label="Role label"
                  value={entry.role}
                  onChange={(event) =>
                    handleRoleEntryChange(entry.id, { role: event.currentTarget.value })
                  }
                  placeholder="Guide"
                  w={200}
                />
                <NumberInput
                  label="Required"
                  value={entry.required ?? undefined}
                  onChange={(value) =>
                    handleRoleEntryChange(entry.id, {
                      required: typeof value === "number" ? value : null,
                    })
                  }
                  min={0}
                  w={120}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => handleRemoveRole(entry.id)}
                  aria-label="Remove role"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              No required roles defined yet.
            </Text>
          )}
        </Stack>
        <Button onClick={handleSubmit} loading={submitting} disabled={!instance || !date || !timeStart}>
          Save changes
        </Button>
      </Stack>
    </Modal>
  );
};

export default EditShiftInstanceModal;
