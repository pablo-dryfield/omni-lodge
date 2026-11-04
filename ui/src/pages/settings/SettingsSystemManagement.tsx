import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconExternalLink,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import axios from "../../utils/axiosInstance";

export default function SettingsSystemManagement() {
  const [capabilities, setCapabilities] = useState<{
      enabled: boolean;
      origin: string;
      provisioned: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null),
    launched = useRef(false),
    pendingNonce = useRef("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setCapabilities(
        (await axios.get("/system-management/capabilities")).data,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const openFullWindow = async () => {
    if (!capabilities) return;
    const target = `omnilodge-system-${crypto.randomUUID()}`,
      popup = window.open("about:blank", target);
    if (!popup) {
      setError("Allow this site to open the standalone console window.");
      return;
    }
    popup.opener = null;
    try {
      const result = (await axios.post("/system-management/launch")).data;
      const form = document.createElement("form");
      form.method = "POST";
      form.action = capabilities.origin + "/management/session/launch";
      form.target = target;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "grant";
      input.value = result.grant;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      form.remove();
    } catch (error) {
      popup.close();
      setError((error as Error).message);
    }
  };
  const launch = useCallback(async () => {
    if (!capabilities || !iframe.current?.contentWindow) return;
    try {
      const result = (await axios.post("/system-management/launch")).data;
      const nonce = crypto.randomUUID();
      pendingNonce.current = nonce;
      iframe.current.contentWindow.postMessage(
        { type: "omnilodge-management-launch", grant: result.grant, nonce },
        capabilities.origin,
      );
      launched.current = true;
    } catch (e) {
      setError(
        (e as { response?: { data?: { message?: string } } }).response?.data
          ?.message || (e as Error).message,
      );
    }
  }, [capabilities]);
  useEffect(() => {
    if (!capabilities) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== capabilities.origin ||
        event.source !== iframe.current?.contentWindow
      )
        return;
      if (event.data?.type === "omnilodge-management-ready") {
        setReady(true);
        if (!launched.current) void launch();
      }
      if (
        event.data?.type === "omnilodge-management-launched" &&
        event.data.nonce === pendingNonce.current
      )
        setError("");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [capabilities, launch]);
  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.settingsSystemManagement}>
      <Stack gap="md">
        <Group justify="space-between">
          <Group>
            <IconTerminal2 size={26} />
            <div>
              <Title order={2}>System Management</Title>
              <Text c="dimmed" size="sm">
                SSH, files and server operations
              </Text>
            </div>
          </Group>
          <Group>
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              loading={loading}
              onClick={() => void load()}
            >
              Refresh
            </Button>
            {capabilities?.enabled && (
              <Button
                variant="light"
                leftSection={<IconExternalLink size={16} />}
                onClick={() => void openFullWindow()}
              >
                Open full window
              </Button>
            )}
          </Group>
        </Group>
        {error && (
          <Alert color="red" title="Unable to open System Management">
            {error}
          </Alert>
        )}
        {loading && !capabilities && <Loader />}
        {capabilities && !capabilities.enabled && (
          <Paper withBorder p="xl" radius="lg">
            <Stack align="center" py="xl">
              <IconTerminal2 size={42} />
              <Title order={3}>Server administration is not enabled</Title>
              <Text c="dimmed" ta="center">
                Configure the isolated console and server profiles in Control
                Panel, then enable System Management after its readiness checks
                pass.
              </Text>
              <Button component="a" href="/settings/control-panel">
                Open Control Panel
              </Button>
            </Stack>
          </Paper>
        )}
        {capabilities?.enabled && (
          <>
            <iframe
              ref={iframe}
              src={capabilities.origin}
              title="Isolated System Management console"
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="no-referrer"
              style={{
                width: "100%",
                height: "calc(100dvh - 230px)",
                minHeight: 600,
                border: "1px solid var(--mantine-color-gray-3)",
                borderRadius: 14,
                background: "var(--mantine-color-body)",
              }}
            />
            {ready && (
              <Button variant="subtle" onClick={() => void launch()}>
                Reauthorize console
              </Button>
            )}
          </>
        )}
      </Stack>
    </PageAccessGuard>
  );
}
