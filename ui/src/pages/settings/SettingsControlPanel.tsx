import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconDeviceFloppy, IconEye, IconRefresh, IconSettings } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  revealConfigSecret,
  useConfigEntries,
  useUpdateConfigEntry,
  type ConfigEntry,
  restoreConfigDefaults,
} from "../../api/config";

const PAGE_SLUG = PAGE_SLUGS.settingsControlPanel;

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const maybeResponse = (error as { response?: { data?: unknown } }).response;
    if (maybeResponse?.data) {
      const { data } = maybeResponse;
      if (typeof data === "string") {
        return data;
      }
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (first && typeof first === "object" && "message" in first && typeof first.message === "string") {
          return first.message;
        }
      }
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred";
};

const formatValue = (entry: ConfigEntry): string => {
  if (entry.isSecret) {
    return entry.isSet ? entry.maskedValue ?? "********" : "Not set";
  }

  if (entry.value != null) {
    if (entry.valueType === "boolean") {
      return entry.value.toString() === "true" ? "Enabled" : "Disabled";
    }
    return entry.value;
  }

  if (entry.defaultValue != null) {
    return `Default: ${entry.defaultValue}`;
  }

  return "Not set";
};

const resolveInitialValue = (entry: ConfigEntry): string | number | boolean | null => {
  if (entry.isSecret) {
    return "";
  }

  const raw = entry.value ?? entry.defaultValue ?? "";
  if (entry.valueType === "boolean") {
    return raw.toString() === "true";
  }
  if (entry.valueType === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (entry.valueType === "json") {
    return typeof raw === "string" ? raw : "";
  }
  return raw;
};

const SettingsControlPanel = () => {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const { data, isLoading, isError, error, refetch, isFetching } = useConfigEntries();
  const updateConfig = useUpdateConfigEntry();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<ConfigEntry | null>(null);
  const [editValue, setEditValue] = useState<string | number | boolean | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [revealLoading, setRevealLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [clearRequested, setClearRequested] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ seededCount: number; seededKeys: string[] } | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const entries = useMemo(() => data ?? [], [data]);

  const categories = useMemo(() => {
    const unique = new Set(entries.map((entry) => entry.category));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (selectedCategory && entry.category !== selectedCategory) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        entry.key.toLowerCase().includes(term) ||
        entry.label.toLowerCase().includes(term) ||
        (entry.description ?? "").toLowerCase().includes(term)
      );
    });
  }, [entries, search, selectedCategory]);

  const openEditor = (entry: ConfigEntry) => {
    setActiveEntry(entry);
    setEditValue(resolveInitialValue(entry));
    setPassword("");
    setReason("");
    setModalError(null);
    setClearRequested(false);
  };

  const closeEditor = () => {
    if (updateConfig.isPending) {
      return;
    }
    setActiveEntry(null);
    setEditValue(null);
    setPassword("");
    setReason("");
    setModalError(null);
    setClearRequested(false);
  };

  const handleRestoreDefaults = async () => {
    if (!restorePassword.trim()) {
      setRestoreError("Enter your password to restore missing defaults.");
      return;
    }
    setRestoreError(null);
    setRestoreLoading(true);
    try {
      const result = await restoreConfigDefaults(restorePassword.trim());
      setRestoreResult(result);
      setRestorePassword("");
      setRestoreOpen(false);
      await refetch();
    } catch (err) {
      setRestoreError(extractErrorMessage(err));
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeEntry) {
      return;
    }

    setModalError(null);

    if (activeEntry.isSecret && !clearRequested && (editValue == null || editValue === "")) {
      setModalError("Enter a new value or choose Clear to unset this secret.");
      return;
    }

    let valuePayload: unknown = editValue;
    if (activeEntry.valueType === "number") {
      valuePayload = typeof editValue === "number" ? editValue : editValue ? Number(editValue) : null;
    } else if (activeEntry.valueType === "boolean") {
      valuePayload = Boolean(editValue);
    } else if (activeEntry.valueType === "string" || activeEntry.valueType === "enum") {
      valuePayload = typeof editValue === "string" ? editValue : editValue == null ? null : String(editValue);
    } else if (activeEntry.valueType === "json") {
      valuePayload = typeof editValue === "string" ? editValue : editValue ?? null;
    }
    if (clearRequested) {
      valuePayload = null;
    }

    try {
      await updateConfig.mutateAsync({
        key: activeEntry.key,
        value: valuePayload,
        password: activeEntry.isSecret ? password : undefined,
        reason: reason.trim().length > 0 ? reason.trim() : undefined,
      });
      closeEditor();
    } catch (err) {
      setModalError(extractErrorMessage(err));
    }
  };

  const handleReveal = async () => {
    if (!activeEntry || !activeEntry.isSecret) {
      return;
    }
    if (!password.trim()) {
      setModalError("Enter your password to reveal this secret.");
      return;
    }
    setModalError(null);
    setRevealLoading(true);
    try {
      const response = await revealConfigSecret(activeEntry.key, password);
      setEditValue(response.value ?? "");
    } catch (err) {
      setModalError(extractErrorMessage(err));
    } finally {
      setRevealLoading(false);
    }
  };

  const renderEditorInput = () => {
    if (!activeEntry) {
      return null;
    }

    if (activeEntry.valueType === "boolean") {
      return (
        <Switch
          label="Value"
          checked={Boolean(editValue)}
          onChange={(event) => setEditValue(event.currentTarget.checked)}
        />
      );
    }

    if (activeEntry.valueType === "number") {
      return (
        <NumberInput
          label="Value"
          value={typeof editValue === "number" ? editValue : editValue ? Number(editValue) : undefined}
          onChange={(value) => setEditValue(value === "" ? null : value)}
          min={0}
        />
      );
    }

    const options = (activeEntry.validationRules?.options as string[] | undefined) ?? [];
    if (activeEntry.valueType === "enum" && options.length > 0) {
      return (
        <Select
          label="Value"
          data={options.map((value) => ({ value, label: value }))}
          value={typeof editValue === "string" ? editValue : null}
          onChange={setEditValue}
          clearable
        />
      );
    }

    if (activeEntry.valueType === "json") {
      return (
        <Textarea
          label="Value (JSON)"
          value={typeof editValue === "string" ? editValue : editValue ? JSON.stringify(editValue, null, 2) : ""}
          onChange={(event) => setEditValue(event.currentTarget.value)}
          minRows={4}
        />
      );
    }

    if (activeEntry.key.includes("QUERY")) {
      return (
        <Textarea
          label="Value"
          value={typeof editValue === "string" ? editValue : ""}
          onChange={(event) => setEditValue(event.currentTarget.value)}
          minRows={3}
        />
      );
    }

    return (
      <TextInput
        label="Value"
        value={typeof editValue === "string" ? editValue : ""}
        onChange={(event) => setEditValue(event.currentTarget.value)}
      />
    );
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap={isMobile ? "md" : "xl"}>
        <Stack gap={6}>
          <Title order={3}>Control Panel</Title>
          <Text size="sm" c="dimmed">
            Manage dynamic configuration values for the platform. Sensitive values require password confirmation.
          </Text>
        </Stack>

        <Card withBorder padding={isMobile ? "md" : "lg"} radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Group
                gap="sm"
                align="flex-end"
                wrap="wrap"
                style={{ width: isMobile ? "100%" : undefined }}
              >
                <TextInput
                  label="Search"
                  placeholder="Search keys or labels"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  w={isMobile ? "100%" : 260}
                />
                <Select
                  label="Category"
                  placeholder="All categories"
                  data={categories.map((category) => ({ value: category, label: category }))}
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  clearable
                  w={isMobile ? "100%" : 260}
                />
              </Group>
              <Group gap="sm" wrap="wrap" style={{ width: isMobile ? "100%" : undefined }}>
                <Button
                  variant="default"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => refetch()}
                  loading={isFetching}
                  fullWidth={isMobile}
                >
                  Refresh
                </Button>
                <Button
                  variant="light"
                  color="orange"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => {
                    setRestoreError(null);
                    setRestoreOpen(true);
                  }}
                  fullWidth={isMobile}
                >
                  Restore missing defaults
                </Button>
              </Group>
            </Group>

            {isError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {extractErrorMessage(error)}
              </Alert>
            ) : null}

            {restoreResult ? (
              <Alert color="teal" icon={<IconRefresh size={16} />}>
                <Stack gap={4}>
                  <Text size="sm">
                    {restoreResult.seededCount > 0
                      ? `Restored ${restoreResult.seededCount} missing value${restoreResult.seededCount === 1 ? "" : "s"}.`
                      : "No missing configuration values were restored."}
                  </Text>
                  {restoreResult.seededKeys.length > 0 ? (
                    <Text size="xs" c="dimmed">
                      {restoreResult.seededKeys.join(", ")}
                    </Text>
                  ) : null}
                </Stack>
              </Alert>
            ) : null}

            {isLoading ? (
              <Text size="sm" c="dimmed">
                Loading configuration...
              </Text>
            ) : filteredEntries.length === 0 ? (
              <Text size="sm" c="dimmed">
                No configuration entries match your filters.
              </Text>
            ) : isMobile ? (
              <Stack gap="sm">
                {filteredEntries.map((entry) => (
                  <Card key={entry.key} withBorder padding="sm" radius="md">
                    <Stack gap="xs">
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Stack gap={2} style={{ minWidth: 0 }}>
                          <Text fw={600}>{entry.label}</Text>
                          <Text size="xs" c="dimmed">
                            {entry.key}
                          </Text>
                        </Stack>
                        <Badge variant="light">{entry.category}</Badge>
                      </Group>
                      {entry.description ? (
                        <Text size="xs" c="dimmed">
                          {entry.description}
                        </Text>
                      ) : null}
                      <Text size="sm">{formatValue(entry)}</Text>
                      <Group justify="flex-end">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconSettings size={14} />}
                          onClick={() => openEditor(entry)}
                          disabled={!entry.isEditable}
                        >
                          Edit
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <Table striped highlightOnHover withTableBorder withColumnBorders style={{ minWidth: 900 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Setting</Table.Th>
                      <Table.Th>Category</Table.Th>
                      <Table.Th>Value</Table.Th>
                      <Table.Th ta="right">Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredEntries.map((entry) => (
                      <Table.Tr key={entry.key}>
                        <Table.Td>
                          <Stack gap={4}>
                            <Text fw={600}>{entry.label}</Text>
                            <Text size="xs" c="dimmed">
                              {entry.key}
                            </Text>
                            {entry.description ? (
                              <Text size="xs" c="dimmed">
                                {entry.description}
                              </Text>
                            ) : null}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light">{entry.category}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatValue(entry)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group justify="flex-end">
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconSettings size={14} />}
                              onClick={() => openEditor(entry)}
                              disabled={!entry.isEditable}
                            >
                              Edit
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={restoreOpen}
        onClose={() => {
          if (restoreLoading) {
            return;
          }
          setRestoreOpen(false);
          setRestorePassword("");
          setRestoreError(null);
        }}
        title="Restore missing defaults"
        centered
        size="md"
        fullScreen={isMobile}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will insert any missing configuration values from defaults or environment fallback values.
          </Text>
          <TextInput
            label="Password confirmation"
            type="password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.currentTarget.value)}
            placeholder="Enter your password"
          />
          {restoreError ? (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {restoreError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                if (restoreLoading) {
                  return;
                }
                setRestoreOpen(false);
                setRestorePassword("");
                setRestoreError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="orange"
              leftSection={<IconRefresh size={16} />}
              onClick={handleRestoreDefaults}
              loading={restoreLoading}
            >
              Restore
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={activeEntry != null}
        onClose={closeEditor}
        title={activeEntry ? `Edit ${activeEntry.label}` : "Edit config"}
        centered
        size="lg"
        fullScreen={isMobile}
      >
        {activeEntry ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {activeEntry.description ?? "Update this configuration value."}
            </Text>

            {renderEditorInput()}

            {activeEntry.isSecret ? (
              <TextInput
                label="Password confirmation"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="Enter your password to confirm"
              />
            ) : null}

            {activeEntry.isSecret ? (
              <Button
                variant="subtle"
                leftSection={<IconEye size={14} />}
                onClick={handleReveal}
                loading={revealLoading}
              >
                Reveal value
              </Button>
            ) : null}

            <Textarea
              label="Reason (optional)"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              minRows={2}
            />

            {modalError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {modalError}
              </Alert>
            ) : null}

            <Group justify="space-between" wrap="wrap">
              <Group gap="xs" wrap="wrap">
                <Button variant="default" onClick={closeEditor} disabled={updateConfig.isPending}>
                  Cancel
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    setEditValue("");
                    setClearRequested(true);
                  }}
                  disabled={updateConfig.isPending}
                >
                  Clear value
                </Button>
              </Group>
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={handleSave}
                loading={updateConfig.isPending}
                fullWidth={isMobile}
              >
                Save changes
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>
    </PageAccessGuard>
  );
};

export default SettingsControlPanel;
