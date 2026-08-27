import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandFacebook,
  IconBrandWhatsapp,
  IconCheck,
  IconClock,
  IconRefresh,
  IconShieldLock,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  completeWhatsAppEmbeddedSignup,
  fetchWhatsAppAdminStatus,
  prepareWhatsAppEmbeddedSignup,
  WHATSAPP_ADMIN_STATUS_QUERY_KEY,
  type WhatsAppAdminStatus,
  type WhatsAppEmbeddedSignupAttempt,
} from "../../api/whatsappAdmin";
import {
  loadMetaFacebookSdk,
  META_WHATSAPP_SESSION_INFO_VERSION,
  META_WHATSAPP_SIGNUP_FEATURE,
  parseWhatsAppEmbeddedSignupMessage,
  type WhatsAppEmbeddedSignupSession,
} from "../../utils/metaWhatsAppSignup";

const PAGE_SLUG = PAGE_SLUGS.settingsControlPanel;
const PAIRING_TIMEOUT_MS = 25_000;
const MANUAL_RECOVERY_MESSAGE = "The latest one-time setup attempt has an ambiguous outcome. Do not retry or prepare a fresh connection; use the explicit manual recovery or offboarding process.";

type FlowStage =
  | "idle"
  | "preparing"
  | "ready"
  | "opening"
  | "waiting"
  | "submitting"
  | "complete"
  | "warning"
  | "error";

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (typeof data === "string" && data.trim()) return data;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (typeof first === "object" && first !== null && "message" in first) {
        const message = (first as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
    }
    if (typeof data === "object" && data !== null && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return error instanceof Error && error.message ? error.message : "Unexpected error occurred";
};

const statusColor = (status: string | null): string => {
  const value = (status ?? "").toLowerCase();
  if (["connected", "complete", "completed", "success", "succeeded", "requested"].includes(value)) return "teal";
  if (value === "declined") return "blue";
  if (["failed", "error", "unavailable", "disconnected"].includes(value)) return "red";
  if (["pending", "preparing", "provisioning", "in_progress", "in-progress", "syncing", "claimed", "unknown"].includes(value)) {
    return "yellow";
  }
  return "gray";
};

const displayStatus = (status: string | null): string =>
  status ? status.replace(/[_-]+/g, " ") : "Not started";

const maskMetaId = (value: string | null): string => {
  if (!value) return "Not configured";
  return value.length <= 6 ? "Configured" : `••••${value.slice(-6)}`;
};

const formatDateTime = (value: string | null): string => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const syncRequestSucceeded = (status: string | null): boolean =>
  ["succeeded", "requested", "in_progress", "complete", "declined"].includes(status ?? "");

const completedWithoutWarnings = (status: WhatsAppAdminStatus): boolean =>
  status.connectionStatus === "connected"
  && status.tokenConfigured
  && status.wabaConfigured
  && status.phoneNumberConfigured
  && syncRequestSucceeded(status.appStateSyncStatus)
  && syncRequestSucceeded(status.historyDispatchStatus)
  && !status.recoveryRequired
  && !status.lastErrorCode;

const completionWasConfirmed = (status: WhatsAppAdminStatus, attemptId: string): boolean =>
  status.latestAttemptId === attemptId
  && status.connectionStatus === "connected"
  && ["complete", "completed"].includes((status.onboardingStatus ?? "").toLowerCase());

const freshAttemptIsSafe = (status: WhatsAppAdminStatus, attemptId: string): boolean =>
  status.latestAttemptId === attemptId
  && !status.recoveryRequired
  && ["failed", "expired"].includes((status.onboardingStatus ?? "").toLowerCase());

const SettingsWhatsApp = () => {
  const queryClient = useQueryClient();
  const statusQuery = useQuery<WhatsAppAdminStatus>({
    queryKey: WHATSAPP_ADMIN_STATUS_QUERY_KEY,
    queryFn: fetchWhatsAppAdminStatus,
  });
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<FlowStage>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [preparedExpiresAt, setPreparedExpiresAt] = useState<string | null>(null);

  const attemptRef = useRef<WhatsAppEmbeddedSignupAttempt | null>(null);
  const sdkRef = useRef<MetaFacebookSdk | null>(null);
  const codeRef = useRef<string | null>(null);
  const sessionRef = useRef<WhatsAppEmbeddedSignupSession | null>(null);
  const completionStartedRef = useRef(false);
  const flowActiveRef = useRef(false);
  const pairingTimeoutRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearPairingTimeout = useCallback(() => {
    if (pairingTimeoutRef.current !== null) {
      window.clearTimeout(pairingTimeoutRef.current);
      pairingTimeoutRef.current = null;
    }
  }, []);

  const clearSensitiveFlowData = useCallback((clearAttempt: boolean) => {
    clearPairingTimeout();
    codeRef.current = null;
    sessionRef.current = null;
    completionStartedRef.current = false;
    flowActiveRef.current = false;
    if (clearAttempt) {
      attemptRef.current = null;
      sdkRef.current = null;
      if (mountedRef.current) setPreparedExpiresAt(null);
    }
  }, [clearPairingTimeout]);

  const failFlow = useCallback((message: string) => {
    clearSensitiveFlowData(true);
    if (!mountedRef.current) return;
    setFeedback(message);
    setStage("error");
  }, [clearSensitiveFlowData]);

  const startPairingTimeout = useCallback(() => {
    if (pairingTimeoutRef.current !== null || completionStartedRef.current) return;
    pairingTimeoutRef.current = window.setTimeout(() => {
      failFlow("Meta did not return both completion signals in time. Prepare a new connection and try again.");
    }, PAIRING_TIMEOUT_MS);
  }, [failFlow]);

  const applyCompletionStatus = useCallback((status: WhatsAppAdminStatus) => {
    queryClient.setQueryData(WHATSAPP_ADMIN_STATUS_QUERY_KEY, status);
    if (!mountedRef.current) return;
    if (completedWithoutWarnings(status)) {
      setFeedback("WhatsApp Business is connected. App-state and history sync requests were submitted safely.");
      setStage("complete");
    } else {
      setFeedback("Connection details were saved, but the initial sync needs attention. Review the statuses above before retrying anything.");
      setStage("warning");
    }
  }, [queryClient]);

  const submitWhenReady = useCallback(() => {
    const attempt = attemptRef.current;
    const code = codeRef.current;
    const session = sessionRef.current;
    if (!attempt || !code || !session || completionStartedRef.current) return;

    completionStartedRef.current = true;
    flowActiveRef.current = false;
    clearPairingTimeout();
    if (mountedRef.current) {
      setFeedback("Securing the Meta connection and requesting the initial sync…");
      setStage("submitting");
    }

    // Keep the single-use authorization material in local scope only for this request.
    codeRef.current = null;
    sessionRef.current = null;
    attemptRef.current = null;
    sdkRef.current = null;
    setPreparedExpiresAt(null);

    void completeWhatsAppEmbeddedSignup(attempt.id, {
      nonce: attempt.nonce,
      code,
      session,
    })
      .then((status) => {
        applyCompletionStatus(status);
      })
      .catch(async () => {
        try {
          const status = await fetchWhatsAppAdminStatus();
          queryClient.setQueryData(WHATSAPP_ADMIN_STATUS_QUERY_KEY, status);
          if (completionWasConfirmed(status, attempt.id)) {
            applyCompletionStatus(status);
            return;
          }
          if (status.recoveryRequired) {
            if (!mountedRef.current) return;
            setFeedback(MANUAL_RECOVERY_MESSAGE);
            setStage("warning");
            return;
          }
          if (freshAttemptIsSafe(status, attempt.id)) {
            if (!mountedRef.current) return;
            setFeedback("The one-time code was discarded and the server marked this attempt as safely ended. Prepare a fresh secure connection to try again.");
            setStage("warning");
            return;
          }
        } catch {
          // The authorization code is one-use and has already been discarded; never replay it.
        }
        if (!mountedRef.current) return;
        setFeedback("The one-time code was discarded, but the final status could not be confirmed. Use Refresh status and do not retry until the status gives a safe next action.");
        setStage("warning");
      });
  }, [applyCompletionStatus, clearPairingTimeout, queryClient]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!flowActiveRef.current || completionStartedRef.current) return;
      const session = parseWhatsAppEmbeddedSignupMessage(event);
      if (!session) return;
      sessionRef.current = session;
      startPairingTimeout();
      if (mountedRef.current) {
        setFeedback("Meta confirmed the WhatsApp Business account. Waiting for the secure authorization code…");
        setStage("waiting");
      }
      submitWhenReady();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [startPairingTimeout, submitWhenReady]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPairingTimeout();
      codeRef.current = null;
      sessionRef.current = null;
      attemptRef.current = null;
      sdkRef.current = null;
      completionStartedRef.current = false;
      flowActiveRef.current = false;
    };
  }, [clearPairingTimeout]);

  const handlePrepare = async () => {
    const passwordValue = password.trim();
    if (!passwordValue) {
      setFeedback("Enter your administrator password to prepare the connection.");
      setStage("error");
      return;
    }

    clearSensitiveFlowData(true);
    setPassword("");
    setFeedback(null);
    setStage("preparing");
    try {
      const attempt = await prepareWhatsAppEmbeddedSignup(passwordValue);
      if (new Date(attempt.expiresAt).getTime() <= Date.now()) {
        throw new Error("The connection attempt expired before it was ready. Please prepare a new one.");
      }
      const sdk = await loadMetaFacebookSdk({
        appId: attempt.launch.appId,
        graphApiVersion: attempt.launch.graphApiVersion,
      });
      if (!mountedRef.current) return;
      attemptRef.current = attempt;
      sdkRef.current = sdk;
      setPreparedExpiresAt(attempt.expiresAt);
      setFeedback("Ready. Continue with Meta while this secure attempt is active.");
      setStage("ready");
    } catch (error) {
      failFlow(extractErrorMessage(error));
    }
  };

  const handleMetaLoginResponse = (response: MetaFacebookLoginResponse) => {
    if (!flowActiveRef.current || completionStartedRef.current) return;
    const code = response.authResponse?.code;
    if (typeof code !== "string" || code.length === 0 || code.length > 4096 || /\s/.test(code)) {
      failFlow("Meta sign-in was cancelled or did not return a usable authorization code.");
      return;
    }
    codeRef.current = code;
    startPairingTimeout();
    if (mountedRef.current) {
      setFeedback("Authorization received. Waiting for Meta to confirm the WhatsApp Business account…");
      setStage("waiting");
    }
    submitWhenReady();
  };

  const handleLaunch = () => {
    const attempt = attemptRef.current;
    const sdk = sdkRef.current;
    if (!attempt || !sdk) {
      failFlow("Prepare a fresh connection before opening Meta.");
      return;
    }
    if (new Date(attempt.expiresAt).getTime() <= Date.now()) {
      failFlow("This secure connection attempt expired. Prepare a new one and try again.");
      return;
    }

    codeRef.current = null;
    sessionRef.current = null;
    completionStartedRef.current = false;
    flowActiveRef.current = true;
    setFeedback("Complete the Meta flow and confirm the connection in your WhatsApp Business app.");
    setStage("opening");

    // This call must remain directly inside the click handler so browsers treat it as user-initiated.
    sdk.login(handleMetaLoginResponse, {
      config_id: attempt.launch.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: META_WHATSAPP_SIGNUP_FEATURE,
        sessionInfoVersion: META_WHATSAPP_SESSION_INFO_VERSION,
      },
    });
  };

  const handleReset = () => {
    clearSensitiveFlowData(true);
    setFeedback(null);
    setStage("idle");
  };

  const status = statusQuery.data;
  const isBusy = ["preparing", "opening", "waiting", "submitting"].includes(stage);
  const canLaunch = stage === "ready" && Boolean(attemptRef.current && sdkRef.current);
  const flowAlertColor = stage === "complete"
    ? "teal"
    : stage === "warning"
      ? "yellow"
      : stage === "error"
        ? "red"
        : "blue";
  const flowAlertIcon = stage === "complete"
    ? <IconCheck size={18} />
    : stage === "error"
      ? <IconAlertCircle size={18} />
      : <IconClock size={18} />;
  const statusUpdatedLabel = useMemo(() => formatDateTime(status?.updatedAt ?? null), [status?.updatedAt]);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="xl">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={4}>
            <Group gap="sm">
              <ThemeIcon color="teal" variant="light" size="lg">
                <IconBrandWhatsapp size={22} />
              </ThemeIcon>
              <Title order={3}>WhatsApp Business</Title>
            </Group>
            <Text size="sm" c="dimmed" maw={720}>
              Connect the existing WhatsApp Business app number to Meta Cloud API while continuing to use the mobile app.
              OmniLodge receives messages for the private morning brief and does not add an outbound messaging control here.
            </Text>
          </Stack>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            loading={statusQuery.isFetching}
            onClick={() => void statusQuery.refetch()}
          >
            Refresh status
          </Button>
        </Group>

        {statusQuery.isError ? (
          <Alert color="red" title="Unable to read WhatsApp status" icon={<IconAlertCircle size={18} />}>
            {extractErrorMessage(statusQuery.error)}
          </Alert>
        ) : null}

        <Card withBorder radius="md" padding="lg">
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="wrap">
              <Stack gap={2}>
                <Text fw={600}>Connection status</Text>
                <Text size="xs" c="dimmed">Last updated {statusUpdatedLabel}</Text>
              </Stack>
              <Badge color={statusColor(status?.connectionStatus ?? null)} variant="light" size="lg">
                {statusQuery.isLoading ? "Loading" : displayStatus(status?.connectionStatus ?? "unavailable")}
              </Badge>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
              <Stack gap={3}>
                <Text size="xs" c="dimmed">Business token</Text>
                <Badge color={status?.tokenConfigured ? "teal" : "gray"} variant="dot">
                  {status?.tokenConfigured ? "Stored securely" : "Not configured"}
                </Badge>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">Meta launch configuration</Text>
                <Badge color={status?.launchConfigured ? "teal" : "gray"} variant="dot">
                  {status?.launchConfigured ? "Ready" : "Incomplete"}
                </Badge>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">Coexistence verification</Text>
                <Badge color={status?.coexistenceVerified ? "teal" : "gray"} variant="dot">
                  {status?.coexistenceVerified ? "Verified" : "Not verified"}
                </Badge>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">WABA ID</Text>
                <Text size="sm" fw={500}>{maskMetaId(status?.wabaId ?? null)}</Text>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">Phone number ID</Text>
                <Text size="sm" fw={500}>{maskMetaId(status?.phoneNumberId ?? null)}</Text>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">Onboarding</Text>
                <Badge color={statusColor(status?.onboardingStatus ?? null)} variant="light">
                  {displayStatus(status?.onboardingStatus ?? null)}
                </Badge>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">App-state sync</Text>
                <Badge color={statusColor(status?.appStateSyncStatus ?? null)} variant="light">
                  {displayStatus(status?.appStateSyncStatus ?? null)}
                </Badge>
              </Stack>
              <Stack gap={3}>
                <Text size="xs" c="dimmed">History sync progress</Text>
                <Badge color={statusColor(status?.historySyncStatus ?? null)} variant="light">
                  {displayStatus(status?.historySyncStatus ?? null)}
                </Badge>
              </Stack>
            </SimpleGrid>

            {status?.recoveryRequired ? (
              <Alert color="yellow" title="Manual recovery required" icon={<IconAlertCircle size={18} />}>
                {MANUAL_RECOVERY_MESSAGE}
              </Alert>
            ) : null}

            {status?.lastErrorCode ? (
              <Alert color="orange" title="Latest sanitized Meta error">
                {status.lastErrorCode}
              </Alert>
            ) : null}
          </Stack>
        </Card>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Group gap="sm">
                <IconShieldLock size={20} />
                <Title order={4}>1. Prepare a secure attempt</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Re-enter your administrator password. The server creates a short-lived, single-use attempt and returns only
                safe Meta launch settings.
              </Text>
              <PasswordInput
                label="Administrator password"
                placeholder="Enter your current password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="current-password"
                disabled={isBusy || stage === "ready"}
              />
              <Button
                variant="light"
                leftSection={<IconShieldLock size={16} />}
                onClick={() => void handlePrepare()}
                loading={stage === "preparing"}
                disabled={isBusy || stage === "ready"}
              >
                Prepare connection
              </Button>
            </Stack>
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Group gap="sm">
                <IconBrandFacebook size={20} />
                <Title order={4}>2. Continue with Meta</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Meta opens its official Coexistence flow. Keep the phone with the WhatsApp Business app nearby to confirm the
                connection and approve history sync.
              </Text>
              {preparedExpiresAt ? (
                <Text size="xs" c="dimmed">Secure attempt expires {formatDateTime(preparedExpiresAt)}</Text>
              ) : null}
              <Button
                color="blue"
                leftSection={<IconBrandFacebook size={16} />}
                onClick={handleLaunch}
                disabled={!canLaunch}
              >
                Continue with Meta
              </Button>
              {stage === "opening" || stage === "waiting" ? (
                <Button variant="subtle" color="gray" onClick={handleReset}>
                  Cancel this attempt
                </Button>
              ) : null}
            </Stack>
          </Card>
        </SimpleGrid>

        {feedback ? (
          <Alert
            color={flowAlertColor}
            icon={flowAlertIcon}
            title={
              stage === "error"
                ? "Connection not completed"
                : stage === "warning"
                  ? "Initial sync needs attention"
                  : undefined
            }
          >
            {feedback}
          </Alert>
        ) : null}

        <Card withBorder radius="md" padding="lg">
          <Stack gap="sm">
            <Text fw={600}>Before you start</Text>
            <List size="sm" spacing="xs">
              <List.Item>Use the existing number from the WhatsApp Business app, not a personal WhatsApp number.</List.Item>
              <List.Item>Keep the mobile app current and complete Meta’s in-app confirmation.</List.Item>
              <List.Item>OmniLodge never receives or stores the short-lived Meta authorization code in browser storage.</List.Item>
              <List.Item>The phone number is already registered, so this flow does not register it again.</List.Item>
            </List>
          </Stack>
        </Card>
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsWhatsApp;
