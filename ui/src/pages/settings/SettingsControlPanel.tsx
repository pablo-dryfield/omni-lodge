import { useEffect, useMemo, useState } from "react";
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
  Tabs,
  Pagination,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandStripe,
  IconDeviceFloppy,
  IconExternalLink,
  IconEye,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  revealConfigSecret,
  useConfigEntries,
  useUpdateConfigEntry,
  type ConfigEntry,
  restoreConfigDefaults,
  discoverTripAdvisorQueryId,
  authenticateStripeTestListener,
  fetchStripeTestListenerStatus,
  startStripeTestListener,
  stopStripeTestListener,
  type StripeTestListenerStatus,
} from "../../api/config";
import axiosInstance from "../../utils/axiosInstance";
import { fetchSession } from "../../actions/sessionActions";
import { useAppDispatch } from "../../store/hooks";
import { StructuredJsonEditor } from "../../features/controlPanel/StructuredJsonEditor";
import { RecoveryOfferRulesEditor } from "../../features/controlPanel/RecoveryOfferRulesEditor";
import { ConfigHistoryPanel } from "../../features/controlPanel/ConfigHistoryPanel";
import { ConfigValuePreview } from "../../features/controlPanel/ConfigValuePreview";
import "./SettingsControlPanel.css";

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
        if (
          first &&
          typeof first === "object" &&
          "message" in first &&
          typeof first.message === "string"
        ) {
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

const resolveInitialValue = (
  entry: ConfigEntry,
): string | number | boolean | null => {
  if (entry.isCleared) {
    return null;
  }

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
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const { data, isLoading, isError, error, refetch, isFetching } =
    useConfigEntries();
  const updateConfig = useUpdateConfigEntry();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("all"),
    [sort, setSort] = useState("label"),
    [page, setPage] = useState(1);
  const [editorView, setEditorView] = useState<string | null>("value"),
    [jsonError, setJsonError] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<ConfigEntry | null>(null);
  const [editValue, setEditValue] = useState<string | number | boolean | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [revealLoading, setRevealLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [clearRequested, setClearRequested] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{
    seededCount: number;
    seededKeys: string[];
  } | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [queryDiscoveryLoading, setQueryDiscoveryLoading] = useState(false);
  const [queryDiscoveryMessage, setQueryDiscoveryMessage] = useState<
    string | null
  >(null);
  const [emailTemplateOptions, setEmailTemplateOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [emailTemplatesLoading, setEmailTemplatesLoading] = useState(false);
  const [stripeListenerStatus, setStripeListenerStatus] =
    useState<StripeTestListenerStatus | null>(null);
  const [stripeListenerAction, setStripeListenerAction] = useState<
    "authenticate" | "start" | "stop" | null
  >(null);

  const entries = useMemo(() => data ?? [], [data]);

  const categories = useMemo(() => {
    const unique = new Set(entries.map((entry) => entry.category));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (selectedCategory && entry.category !== selectedCategory) {
          return false;
        }
        if (
          (stateFilter === "secret" && !entry.isSecret) ||
          (stateFilter === "unset" && (entry.isSet || entry.isCleared)) ||
          (stateFilter === "editable" && !entry.isEditable) ||
          (stateFilter === "system" && !entry.isSystemManaged)
        )
          return false;
        if (!term) {
          return true;
        }
        return (
          entry.key.toLowerCase().includes(term) ||
          entry.label.toLowerCase().includes(term) ||
          (entry.description ?? "").toLowerCase().includes(term) ||
          entry.category.toLowerCase().includes(term)
        );
      })
      .sort((a, b) =>
        sort === "updated"
          ? String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
          : sort === "key"
            ? a.key.localeCompare(b.key)
            : a.label.localeCompare(b.label),
      );
  }, [entries, search, selectedCategory, stateFilter, sort]);
  useEffect(() => setPage(1), [search, selectedCategory, stateFilter, sort]);
  useEffect(
    () =>
      setPage((previous) =>
        Math.min(previous, Math.max(1, Math.ceil(filteredEntries.length / 24))),
      ),
    [filteredEntries.length],
  );
  const visibleEntries = filteredEntries.slice((page - 1) * 24, page * 24);

  useEffect(() => {
    if (activeEntry?.key !== "BOOKING_TSHIRT_SIZE_EMAIL_TEMPLATE_NAME") {
      return;
    }
    let cancelled = false;
    setEmailTemplatesLoading(true);
    axiosInstance
      .get<{
        templates: Array<{
          name: string;
          templateType: string;
          isActive: boolean;
        }>;
      }>("/email-templates", { withCredentials: true })
      .then((response) => {
        if (cancelled) return;
        setEmailTemplateOptions(
          response.data.templates
            .filter((template) => template.isActive)
            .map((template) => ({
              value: template.name,
              label: `${template.name} · ${template.templateType === "react_email" ? "React Email" : "Plain text"}`,
            })),
        );
      })
      .catch((error) => {
        if (!cancelled) setModalError(extractErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setEmailTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEntry?.key]);

  useEffect(() => {
    if (activeEntry?.key !== "STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET") {
      setStripeListenerStatus(null);
      return;
    }
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const status = await fetchStripeTestListenerStatus();
        if (!cancelled) setStripeListenerStatus(status);
      } catch (err) {
        if (!cancelled) setModalError(extractErrorMessage(err));
      }
    };
    void refreshStatus();
    const interval = window.setInterval(refreshStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeEntry?.key]);

  const openEditor = (entry: ConfigEntry, view = "value") => {
    if (!entry.isEditable && view === "value") {
      return;
    }
    setActiveEntry(entry);
    setEditorView(view);
    setJsonError(null);
    setEditValue(resolveInitialValue(entry));
    setPassword("");
    setReason("");
    setModalError(null);

    setClearRequested(entry.isCleared);
    setQueryDiscoveryMessage(null);
  };

  const handleDiscoverTripAdvisorQueryId = async () => {
    setModalError(null);
    setQueryDiscoveryMessage(null);
    setQueryDiscoveryLoading(true);
    try {
      const result = await discoverTripAdvisorQueryId();
      setEditValue(result.discovery.queryId);
      setClearRequested(false);
      setQueryDiscoveryMessage(
        `Saved and validated ${result.discovery.queryId}; TripAdvisor returned ${result.discovery.sampleCount} of ${result.discovery.totalCount.toLocaleString()} reviews.`,
      );
      await refetch();
    } catch (err) {
      setModalError(extractErrorMessage(err));
    } finally {
      setQueryDiscoveryLoading(false);
    }
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
    if (!clearRequested && activeEntry.valueType === "json" && jsonError) {
      setModalError(jsonError);
      return;
    }

    if (
      activeEntry.isSecret &&
      !clearRequested &&
      (editValue == null || editValue === "")
    ) {
      setModalError("Enter a new value or choose Clear to unset this secret.");
      return;
    }

    let valuePayload: unknown = editValue;
    if (activeEntry.valueType === "number") {
      valuePayload =
        typeof editValue === "number"
          ? editValue
          : editValue
            ? Number(editValue)
            : null;
      if (
        !clearRequested &&
        (valuePayload === null || !Number.isFinite(valuePayload))
      ) {
        setModalError("Enter a valid number, or use Clear value.");
        return;
      }
    } else if (activeEntry.valueType === "boolean") {
      valuePayload = Boolean(editValue);
    } else if (
      activeEntry.valueType === "string" ||
      activeEntry.valueType === "enum"
    ) {
      valuePayload =
        typeof editValue === "string"
          ? editValue
          : editValue == null
            ? null
            : String(editValue);
    } else if (activeEntry.valueType === "json") {
      valuePayload =
        typeof editValue === "string" ? editValue : (editValue ?? null);
    }
    if (clearRequested) {
      valuePayload = null;
    }

    try {
      const refreshSessionConfig = [
        "NOTIFICATION_INBOX_POLLING_ENABLED",
        "BADGE_CAMPAIGN_BASE_URL",
      ].includes(activeEntry.key);
      await updateConfig.mutateAsync({
        key: activeEntry.key,
        value: valuePayload,
        password: activeEntry.isSecret ? password : undefined,
        reason: reason.trim().length > 0 ? reason.trim() : undefined,
      });
      closeEditor();
      if (refreshSessionConfig) {
        void dispatch(fetchSession());
      }
    } catch (err) {
      setModalError(extractErrorMessage(err));
    }
  };

  const handleReveal = async () => {
    if (
      !activeEntry ||
      !activeEntry.isSecret ||
      activeEntry.isRevealable === false
    ) {
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
      setClearRequested(response.value == null);
    } catch (err) {
      setModalError(extractErrorMessage(err));
    } finally {
      setRevealLoading(false);
    }
  };

  const runStripeListenerAction = async (
    action: "authenticate" | "start" | "stop",
  ) => {
    if (action !== "stop" && !password.trim()) {
      setModalError("Enter your password to continue.");
      return;
    }
    setModalError(null);
    setStripeListenerAction(action);
    try {
      const status =
        action === "authenticate"
          ? await authenticateStripeTestListener(password.trim())
          : action === "start"
            ? await startStripeTestListener(password.trim())
            : await stopStripeTestListener();
      setStripeListenerStatus(status);
      if (action === "start") await refetch();
    } catch (err) {
      setModalError(extractErrorMessage(err));
    } finally {
      setStripeListenerAction(null);
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
          onChange={(event) => {
            setEditValue(event.currentTarget.checked);
            setClearRequested(false);
          }}
        />
      );
    }

    if (activeEntry.valueType === "number") {
      return (
        <NumberInput
          label="Value"
          value={
            typeof editValue === "number" || typeof editValue === "string"
              ? editValue
              : ""
          }
          onChange={(value) => {
            setEditValue(value === "" ? null : value);
            setClearRequested(false);
          }}
          min={
            typeof activeEntry.validationRules?.min === "number"
              ? activeEntry.validationRules.min
              : undefined
          }
          max={
            typeof activeEntry.validationRules?.max === "number"
              ? activeEntry.validationRules.max
              : undefined
          }
          allowDecimal={activeEntry.validationRules?.integer !== true}
          thousandSeparator=","
          clampBehavior="none"
        />
      );
    }

    const options =
      (activeEntry.validationRules?.options as string[] | undefined) ?? [];
    if (activeEntry.valueType === "enum" && options.length > 0) {
      return (
        <Select
          label="Value"
          data={options.map((value) => ({ value, label: value }))}
          value={typeof editValue === "string" ? editValue : null}
          onChange={(value) => {
            setEditValue(value);
            setClearRequested(false);
          }}
          clearable
        />
      );
    }

    if (activeEntry.key === "STOREFRONT_RECOVERY_OFFER_RULES") {
      return <RecoveryOfferRulesEditor key={activeEntry.key} value={typeof editValue === "string" ? editValue : ""}
        onChange={value => { setEditValue(value); setClearRequested(false); }} onError={setJsonError} />;
    }

    if (activeEntry.valueType === "json") {
      return (
        <StructuredJsonEditor
          key={activeEntry.key}
          value={
            typeof editValue === "string"
              ? editValue
              : editValue
                ? JSON.stringify(editValue, null, 2)
                : ""
          }
          onChange={(value) => {
            setEditValue(value);
            setClearRequested(false);
          }}
          onError={setJsonError}
        />
      );
    }

    if (activeEntry.key === "BOOKING_TSHIRT_SIZE_EMAIL_TEMPLATE_NAME") {
      return (
        <Select
          label="Existing active email template"
          description="The selected template is referenced as-is. Automation will never rewrite its subject or design."
          placeholder={
            emailTemplatesLoading ? "Loading templates..." : "Select a template"
          }
          data={emailTemplateOptions}
          value={typeof editValue === "string" && editValue ? editValue : null}
          onChange={(value) => {
            setEditValue(value ?? "");
            setClearRequested(false);
          }}
          searchable
          clearable
          disabled={emailTemplatesLoading}
          nothingFoundMessage="No active templates found"
        />
      );
    }

    if (activeEntry.key.includes("QUERY")) {
      return (
        <Textarea
          label="Value"
          value={typeof editValue === "string" ? editValue : ""}
          onChange={(event) => {
            setEditValue(event.currentTarget.value);
            setClearRequested(false);
          }}
          minRows={3}
        />
      );
    }

    return (
      <TextInput
        label="Value"
        value={typeof editValue === "string" ? editValue : ""}
        onChange={(event) => {
          setEditValue(event.currentTarget.value);
          setClearRequested(false);
        }}
      />
    );
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap={isMobile ? "md" : "xl"}>
        <Stack gap={6}>
          <Title order={3}>Control Panel</Title>
          <Text size="sm" c="dimmed">
            Manage dynamic configuration values for the platform. Sensitive
            values require password confirmation.
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
              </Group>
              <Group
                gap="sm"
                wrap="wrap"
                style={{ width: isMobile ? "100%" : undefined }}
              >
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

            <Tabs
              className="cp-tabs"
              value={
                selectedCategory
                  ? "category:" + encodeURIComponent(selectedCategory)
                  : "all"
              }
              onChange={(value) =>
                setSelectedCategory(
                  value && value !== "all"
                    ? decodeURIComponent(value.slice(9))
                    : null,
                )
              }
            >
              <Tabs.List>
                <Tabs.Tab
                  value="all"
                  rightSection={
                    <Badge size="xs" variant="light">
                      {entries.length}
                    </Badge>
                  }
                >
                  All settings
                </Tabs.Tab>
                {categories.map((category) => (
                  <Tabs.Tab
                    value={"category:" + encodeURIComponent(category)}
                    key={category}
                    rightSection={
                      <Badge size="xs" variant="light">
                        {
                          entries.filter((entry) => entry.category === category)
                            .length
                        }
                      </Badge>
                    }
                  >
                    {category}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <Tabs.Panel
                value={
                  selectedCategory
                    ? "category:" + encodeURIComponent(selectedCategory)
                    : "all"
                }
                pt="md"
              >
                <div className="cp-controls">
                  <Select
                    label="Show"
                    value={stateFilter}
                    onChange={(v) => setStateFilter(v || "all")}
                    allowDeselect={false}
                    data={[
                      { value: "all", label: "All values" },
                      { value: "secret", label: "Secrets" },
                      { value: "unset", label: "Not set" },
                      { value: "editable", label: "Editable" },
                      { value: "system", label: "System managed" },
                    ]}
                  />
                  <Select
                    label="Sort by"
                    value={sort}
                    onChange={(v) => setSort(v || "label")}
                    allowDeselect={false}
                    data={[
                      { value: "label", label: "Setting name" },
                      { value: "key", label: "Configuration key" },
                      { value: "updated", label: "Recently changed" },
                    ]}
                  />
                  <Text size="sm" c="dimmed">
                    {filteredEntries.length} matching settings
                  </Text>
                </div>
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
                    Loading configuration…
                  </Text>
                ) : !filteredEntries.length ? (
                  <Stack gap="sm">
                    <Text size="sm" c="dimmed">
                      No settings match these filters.
                    </Text>
                    <Button
                      variant="subtle"
                      onClick={() => {
                        setSearch("");
                        setSelectedCategory(null);
                        setStateFilter("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  </Stack>
                ) : (
                  <>
                    <div className="cp-grid">
                      {visibleEntries.map((entry) => (
                        <Card
                          key={entry.key}
                          withBorder
                          padding="md"
                          radius="md"
                          className="cp-setting"
                          role="group"
                          aria-label={`${entry.label} setting`}
                        >
                          <Stack gap="sm" className="cp-setting-content">
                            <Group
                              justify="space-between"
                              align="flex-start"
                              wrap="nowrap"
                            >
                              <Text fw={600}>{entry.label}</Text>
                              {entry.impact === "high" && (
                                <Badge size="xs" color="orange" variant="light">
                                  High impact
                                </Badge>
                              )}
                            </Group>
                            <Text
                              size="xs"
                              c="dimmed"
                              className="cp-setting-key"
                            >
                              {entry.key}
                            </Text>
                            <Group gap={5}>
                              <Badge size="xs" variant="light" color="gray">
                                {entry.category}
                              </Badge>
                              {entry.isSystemManaged && (
                                <Badge size="xs" variant="outline" color="gray">
                                  System managed
                                </Badge>
                              )}
                            </Group>
                            {entry.description && (
                              <Text size="sm" c="dimmed" lineClamp={3}>
                                {entry.description}
                              </Text>
                            )}
                            <ConfigValuePreview entry={entry} />
                          </Stack>
                          <Group justify="space-between" mt="md" gap="xs">
                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() => openEditor(entry, "history")}
                            >
                              History
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconSettings size={14} />}
                              disabled={!entry.isEditable}
                              onClick={() => openEditor(entry)}
                            >
                              {entry.isEditable ? "Edit setting" : "Read only"}
                            </Button>
                          </Group>
                        </Card>
                      ))}
                    </div>
                    <Group justify="space-between" mt="md">
                      <Text size="sm" c="dimmed">
                        Showing {(page - 1) * 24 + 1}–
                        {Math.min(page * 24, filteredEntries.length)} of{" "}
                        {filteredEntries.length} settings
                      </Text>
                      {filteredEntries.length > 24 && (
                        <Pagination
                          value={page}
                          onChange={setPage}
                          total={Math.ceil(filteredEntries.length / 24)}
                          size="sm"
                          siblings={1}
                        />
                      )}
                    </Group>
                  </>
                )}
              </Tabs.Panel>
            </Tabs>
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
            This will insert any missing configuration values from defaults or
            environment fallback values.
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
        closeButtonProps={{ "aria-label": "Close configuration editor" }}
        onClose={closeEditor}
        title={activeEntry ? `Edit ${activeEntry.label}` : "Edit config"}
        centered
        size={activeEntry?.valueType === "json" ? "xl" : "lg"}
        fullScreen={isMobile}
      >
        {activeEntry ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {activeEntry.description ?? "Update this configuration value."}
            </Text>

            <Group gap="xs">
              <Badge variant="light">{activeEntry.category}</Badge>
              <Badge variant="outline">{activeEntry.valueType}</Badge>
              {activeEntry.impact === "high" && (
                <Badge color="orange">High impact</Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" className="cp-editor-key">
              {activeEntry.key}
            </Text>
            <Tabs value={editorView} onChange={setEditorView}>
              <Tabs.List>
                <Tabs.Tab value="value" disabled={!activeEntry.isEditable}>
                  Edit value
                </Tabs.Tab>
                <Tabs.Tab value="history">Change history</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="value" pt="md">
                <Stack gap="md">
                  {clearRequested && (
                    <Alert color="orange">
                      This value will be cleared and its fallback disabled when
                      you save.
                    </Alert>
                  )}
                  {renderEditorInput()}

                  {activeEntry.key === "TRIP_ADVISOR_QUERY_ID" ? (
                    <Stack gap="xs">
                      <Button
                        variant="light"
                        color="teal"
                        leftSection={<IconRefresh size={16} />}
                        onClick={handleDiscoverTripAdvisorQueryId}
                        loading={queryDiscoveryLoading}
                      >
                        Find, validate, and save latest query ID
                      </Button>
                      <Text size="xs" c="dimmed">
                        Checks discoverable TripAdvisor query registries, tests
                        candidates against your configured location, and saves
                        only an ID that returns reviews.
                      </Text>
                      {queryDiscoveryMessage ? (
                        <Alert color="teal">{queryDiscoveryMessage}</Alert>
                      ) : null}
                    </Stack>
                  ) : null}

                  {activeEntry.isSecret ? (
                    <TextInput
                      label="Password confirmation"
                      type="password"
                      value={password}
                      onChange={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                      placeholder="Enter your password to confirm"
                    />
                  ) : null}

                  {activeEntry.key ===
                    "STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET" &&
                  stripeListenerStatus ? (
                    <Stack
                      gap="sm"
                      p="md"
                      style={{
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: 4,
                      }}
                    >
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Group gap="xs">
                          <IconBrandStripe size={20} />
                          <Text fw={700}>Local Stripe listener</Text>
                        </Group>
                        <Badge
                          color={
                            stripeListenerStatus.state === "running"
                              ? "teal"
                              : stripeListenerStatus.state === "error"
                                ? "red"
                                : "gray"
                          }
                          variant="light"
                        >
                          {stripeListenerStatus.state}
                        </Badge>
                      </Group>

                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {stripeListenerStatus.forwardTo}
                      </Text>

                      {!stripeListenerStatus.available ? (
                        <Alert color="yellow">
                          Local listener controls are disabled in production.
                        </Alert>
                      ) : !stripeListenerStatus.cliInstalled ? (
                        <Alert color="red">
                          Stripe CLI is not available on the backend.
                        </Alert>
                      ) : (
                        <>
                          <Group
                            justify="space-between"
                            align="center"
                            wrap="wrap"
                          >
                            <Text size="sm">
                              CLI authentication:{" "}
                              {stripeListenerStatus.authentication.state.replace(
                                "_",
                                " ",
                              )}
                            </Text>
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconBrandStripe size={15} />}
                              onClick={() =>
                                void runStripeListenerAction("authenticate")
                              }
                              loading={stripeListenerAction === "authenticate"}
                              disabled={
                                stripeListenerStatus.authentication.state ===
                                "awaiting_approval"
                              }
                            >
                              Authenticate again
                            </Button>
                          </Group>

                          {stripeListenerStatus.authentication.state ===
                            "awaiting_approval" &&
                          stripeListenerStatus.authentication.browserUrl ? (
                            <Group
                              justify="space-between"
                              align="center"
                              wrap="wrap"
                            >
                              <Text size="sm" fw={700}>
                                {
                                  stripeListenerStatus.authentication
                                    .verificationCode
                                }
                              </Text>
                              <Button
                                component="a"
                                href={
                                  stripeListenerStatus.authentication.browserUrl
                                }
                                target="_blank"
                                rel="noreferrer"
                                size="xs"
                                rightSection={<IconExternalLink size={14} />}
                              >
                                Open Stripe
                              </Button>
                            </Group>
                          ) : null}

                          <Group gap="sm" wrap="wrap">
                            <Button
                              leftSection={<IconPlayerPlay size={16} />}
                              onClick={() =>
                                void runStripeListenerAction("start")
                              }
                              loading={stripeListenerAction === "start"}
                              disabled={
                                stripeListenerStatus.state === "running" ||
                                stripeListenerStatus.state === "starting" ||
                                stripeListenerStatus.authentication.state !==
                                  "authenticated"
                              }
                            >
                              Start listener
                            </Button>
                            <Button
                              color="red"
                              variant="light"
                              leftSection={<IconPlayerStop size={16} />}
                              onClick={() =>
                                void runStripeListenerAction("stop")
                              }
                              loading={stripeListenerAction === "stop"}
                              disabled={
                                stripeListenerStatus.state !== "running"
                              }
                            >
                              Stop listener
                            </Button>
                            <Badge
                              color={
                                stripeListenerStatus.secretConfigured
                                  ? "teal"
                                  : "gray"
                              }
                              variant="dot"
                            >
                              Secret{" "}
                              {stripeListenerStatus.secretConfigured
                                ? "saved"
                                : "not saved"}
                            </Badge>
                          </Group>
                        </>
                      )}

                      {stripeListenerStatus.message ? (
                        <Alert
                          color={
                            stripeListenerStatus.state === "error"
                              ? "red"
                              : "blue"
                          }
                        >
                          {stripeListenerStatus.message}
                        </Alert>
                      ) : null}
                    </Stack>
                  ) : null}

                  {activeEntry.isSecret &&
                  activeEntry.isRevealable !== false ? (
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

                  <Group
                    justify="space-between"
                    wrap="wrap"
                    className="cp-editor-footer"
                  >
                    <Group gap="xs" wrap="wrap">
                      <Button
                        variant="default"
                        onClick={closeEditor}
                        disabled={updateConfig.isPending}
                      >
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
                      disabled={
                        !activeEntry.isEditable ||
                        (!clearRequested && Boolean(jsonError))
                      }
                    >
                      Save changes
                    </Button>
                  </Group>
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="history" pt="md">
                <ConfigHistoryPanel configKey={activeEntry.key} />
              </Tabs.Panel>
            </Tabs>
          </Stack>
        ) : null}
      </Modal>
    </PageAccessGuard>
  );
};

export default SettingsControlPanel;
