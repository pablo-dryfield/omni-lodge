import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  TextInput,
  Textarea,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight, IconRefresh } from "@tabler/icons-react";
import {
  fetchNotificationPushSubscriptions,
  fetchInboxNotifications,
  sendNotificationPushTest,
  type InboxNotification,
  type NotificationPushSubscriptionDebugResponse,
} from "../api/notifications";
import { useActiveUsers } from "../api/users";
import { useAppSelector } from "../store/hooks";

type NotificationsCenterProps = {
  title?: string;
};

const formatNotificationDate = (value: string) => {
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return "Unknown date";
  }
  return parsed.format("YYYY-MM-DD HH:mm");
};

const formatOptionalDate = (value: string | null) => {
  if (!value) {
    return "Never";
  }
  return formatNotificationDate(value);
};

const shortenEndpoint = (value: string) => {
  if (!value || value.length <= 80) {
    return value;
  }
  return `${value.slice(0, 40)}...${value.slice(-30)}`;
};

const toPushEventLabel = (value: string) => {
  switch (value) {
    case "push_received":
      return "Push received by service worker";
    case "notification_shown":
      return "Notification shown";
    case "notification_show_failed":
      return "Notification show failed";
    case "notification_clicked":
      return "Notification clicked";
    case "notification_closed":
      return "Notification dismissed";
    default:
      return value;
  }
};

const NotificationsCenter: React.FC<NotificationsCenterProps> = ({ title }) => {
  const navigate = useNavigate();
  const roleSlug = useAppSelector((state) => state.session.roleSlug ?? null);
  const { data: activeUsers = [], isLoading: activeUsersLoading } = useActiveUsers();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testerUserId, setTesterUserId] = useState<string | null>(null);
  const [testerTitle, setTesterTitle] = useState("Notification Center test");
  const [testerBody, setTesterBody] = useState("");
  const [testerUrl, setTesterUrl] = useState("/notifications");
  const [testerSubmitting, setTesterSubmitting] = useState(false);
  const [testerError, setTesterError] = useState<string | null>(null);
  const [testerSuccess, setTesterSuccess] = useState<string | null>(null);
  const [testerFailureSummaries, setTesterFailureSummaries] = useState<string[]>([]);
  const [pushDebugLoading, setPushDebugLoading] = useState(false);
  const [pushDebugError, setPushDebugError] = useState<string | null>(null);
  const [pushDebug, setPushDebug] = useState<NotificationPushSubscriptionDebugResponse | null>(
    null,
  );

  const normalizedRoleSlug = useMemo(() => {
    if (!roleSlug) {
      return null;
    }
    const trimmed = roleSlug.trim().toLowerCase();
    const withHyphens = trimmed.replace(/[\s_]+/g, "-");
    const collapsed = withHyphens.replace(/-/g, "");
    if (collapsed === "administrator") {
      return "admin";
    }
    if (collapsed === "assistantmanager" || collapsed === "assistmanager") {
      return "assistant-manager";
    }
    if (collapsed === "mgr") {
      return "manager";
    }
    return withHyphens;
  }, [roleSlug]);

  const canUseTester = useMemo(
    () =>
      normalizedRoleSlug != null &&
      new Set(["admin", "owner", "manager", "assistant-manager"]).has(normalizedRoleSlug),
    [normalizedRoleSlug],
  );

  const activeUserOptions = useMemo(
    () =>
      activeUsers
        .filter((user) => user?.status !== false)
        .map((user) => {
          const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
          const label = fullName || user.email?.trim() || `User #${user.id}`;
          return {
            value: String(user.id),
            label: `${label} (#${user.id})`,
          };
        }),
    [activeUsers],
  );

  useEffect(() => {
    if (title) {
      document.title = title;
    }
  }, [title]);

  useEffect(() => {
    if (testerUserId || activeUserOptions.length === 0) {
      return;
    }
    setTesterUserId(activeUserOptions[0]?.value ?? null);
  }, [activeUserOptions, testerUserId]);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchInboxNotifications({
        limit: 300,
        offset: 0,
      });
      const sorted = [...response.items].sort(
        (a, b) => dayjs(b.sentAt).valueOf() - dayjs(a.sentAt).valueOf(),
      );
      setItems(sorted);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load notifications",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const loadPushDebug = useCallback(async () => {
    if (!canUseTester || !testerUserId) {
      setPushDebug(null);
      setPushDebugError(null);
      return;
    }
    const userId = Number(testerUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setPushDebug(null);
      setPushDebugError("Selected user is invalid.");
      return;
    }

    setPushDebugLoading(true);
    setPushDebugError(null);
    try {
      const response = await fetchNotificationPushSubscriptions(userId);
      setPushDebug(response);
    } catch (requestError) {
      setPushDebug(null);
      setPushDebugError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load push subscriptions.",
      );
    } finally {
      setPushDebugLoading(false);
    }
  }, [canUseTester, testerUserId]);

  useEffect(() => {
    if (!canUseTester || !testerUserId) {
      return;
    }
    loadPushDebug().catch(() => undefined);
  }, [canUseTester, loadPushDebug, testerUserId]);

  const handleSendTestNotification = useCallback(async () => {
    if (!testerUserId) {
      setTesterError("Select a user first.");
      return;
    }
    const userId = Number(testerUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setTesterError("Selected user is invalid.");
      return;
    }

    setTesterSubmitting(true);
    setTesterError(null);
    setTesterSuccess(null);
    setTesterFailureSummaries([]);
    try {
      const result = await sendNotificationPushTest({
        userId,
        title: testerTitle.trim(),
        body: testerBody.trim() || undefined,
        url: testerUrl.trim() || undefined,
      });
      if (!result.sent) {
        setTesterError("Notification test was not delivered.");
        return;
      }
      setTesterSuccess(
        `Sent to user #${result.userId}. Targeted=${result.targetedDeviceCount}, attempted=${result.attemptedDeviceCount}, successful=${result.successfulDeviceCount}, failed=${result.failedDeviceCount}, deactivated=${result.deactivatedDeviceCount}.`,
      );
      setTesterFailureSummaries(result.failureSummaries);
      loadNotifications().catch(() => undefined);
      loadPushDebug().catch(() => undefined);
    } catch (requestError) {
      setTesterError(
        requestError instanceof Error ? requestError.message : "Failed to send test notification.",
      );
    } finally {
      setTesterSubmitting(false);
    }
  }, [loadNotifications, loadPushDebug, testerBody, testerTitle, testerUrl, testerUserId]);

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Title order={2}>Notifications Center</Title>
          <Text c="dimmed" size="sm">
            All your notifications sorted by newest first.
          </Text>
        </Stack>
        <ActionIcon
          variant="light"
          radius="xl"
          size="lg"
          onClick={() => {
            loadNotifications().catch(() => undefined);
          }}
          disabled={loading}
          aria-label="Refresh notifications"
        >
          {loading ? <Loader size={16} /> : <IconRefresh size={18} />}
        </ActionIcon>
      </Group>

      {error && (
        <Alert color="red" title="Unable to load notifications">
          {error}
        </Alert>
      )}

      {canUseTester && (
        <Paper withBorder radius="lg" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Title order={4}>Notification Tester</Title>
              <Text size="xs" c="dimmed">
                Sends push to all active devices for selected user.
              </Text>
            </Group>

            <Select
              label="User"
              placeholder={activeUsersLoading ? "Loading users..." : "Select user"}
              searchable
              clearable={false}
              data={activeUserOptions}
              value={testerUserId}
              onChange={(value) => setTesterUserId(value ?? null)}
              nothingFoundMessage="No active users found"
              disabled={activeUsersLoading || testerSubmitting}
            />

            <TextInput
              label="Title"
              value={testerTitle}
              onChange={(event) => setTesterTitle(event.currentTarget.value)}
              disabled={testerSubmitting}
              maxLength={120}
            />

            <Textarea
              label="Body"
              value={testerBody}
              onChange={(event) => setTesterBody(event.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={5}
              maxLength={500}
              placeholder="Optional custom body"
              disabled={testerSubmitting}
            />

            <TextInput
              label="URL"
              value={testerUrl}
              onChange={(event) => setTesterUrl(event.currentTarget.value)}
              placeholder="/notifications"
              disabled={testerSubmitting}
              maxLength={300}
            />

            {testerError && (
              <Alert color="red" title="Unable to send test">
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {testerError}
                </Text>
              </Alert>
            )}
            {testerSuccess && (
              <Alert color="green" title="Test sent">
                {testerSuccess}
              </Alert>
            )}
            {testerFailureSummaries.length > 0 && (
              <Alert color="yellow" title="Some deliveries failed">
                <Stack gap={2}>
                  {testerFailureSummaries.map((entry, index) => (
                    <Text key={`${entry}-${index}`} size="xs" style={{ whiteSpace: "pre-wrap" }}>
                      {entry}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            )}

            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  loadPushDebug().catch(() => undefined);
                }}
                loading={pushDebugLoading}
                disabled={!testerUserId}
              >
                Refresh Devices
              </Button>
              <Button
                onClick={() => {
                  handleSendTestNotification().catch(() => undefined);
                }}
                loading={testerSubmitting}
                disabled={!testerUserId || activeUsersLoading}
              >
                Send Test Notification
              </Button>
            </Group>

            {pushDebugError && (
              <Alert color="red" title="Unable to load device subscriptions">
                {pushDebugError}
              </Alert>
            )}

            {pushDebug && (
              <Stack gap="xs">
                <Group gap="xs">
                  <Badge color="blue" variant="light">
                    Total: {pushDebug.totalSubscriptions}
                  </Badge>
                  <Badge color={pushDebug.activeSubscriptions > 0 ? "green" : "gray"} variant="light">
                    Active: {pushDebug.activeSubscriptions}
                  </Badge>
                </Group>
                {pushDebug.items.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No push subscriptions found for this user on any device/browser.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {pushDebug.items.map((item) => (
                      <Paper key={item.id} withBorder radius="md" p="sm">
                        <Stack gap={4}>
                          <Group justify="space-between" wrap="wrap">
                            <Group gap="xs">
                              <Badge color={item.isActive ? "green" : "gray"} variant="light">
                                {item.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <Text size="xs" c="dimmed">
                                Subscription #{item.id}
                              </Text>
                            </Group>
                            <Text size="xs" c="dimmed">
                              Updated: {formatOptionalDate(item.updatedAt)}
                            </Text>
                          </Group>
                          <Text size="sm" fw={600}>
                            {item.userAgent?.trim() || "Unknown device/browser"}
                          </Text>
                          <Text size="xs" c="dimmed">
                            Endpoint: {shortenEndpoint(item.endpoint)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            Last success: {formatOptionalDate(item.lastSuccessAt)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            Last failure: {formatOptionalDate(item.lastFailureAt)}
                          </Text>
                          {item.lastFailureReason && (
                            <Text size="xs" c="red">
                              Failure reason: {item.lastFailureReason}
                            </Text>
                          )}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}

                <Title order={5} mt="xs">
                  Recent Receipt Events
                </Title>
                {pushDebug.recentTestEvents.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No service-worker receipt events captured yet for recent tests.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {pushDebug.recentTestEvents.slice(0, 25).map((entry, index) => (
                      <Paper
                        key={`${entry.notificationId}-${entry.at}-${entry.eventType}-${index}`}
                        withBorder
                        radius="md"
                        p="sm"
                      >
                        <Stack gap={3}>
                          <Group justify="space-between" wrap="wrap">
                            <Badge
                              color={entry.eventType === "notification_show_failed" ? "red" : "blue"}
                              variant="light"
                            >
                              {toPushEventLabel(entry.eventType)}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              {formatNotificationDate(entry.at)}
                            </Text>
                          </Group>
                          <Text size="xs" c="dimmed">
                            Notification #{entry.notificationId} | Tag: {entry.tag}
                          </Text>
                          {entry.targetUrl && (
                            <Text size="xs" c="dimmed">
                              Target URL: {entry.targetUrl}
                            </Text>
                          )}
                          {entry.userAgent && (
                            <Text size="xs" c="dimmed">
                              UA: {entry.userAgent}
                            </Text>
                          )}
                          {entry.error && (
                            <Text size="xs" c="red">
                              Error: {entry.error}
                            </Text>
                          )}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>
      )}

      {loading && items.length === 0 ? (
        <Paper withBorder radius="lg" p="md">
          <Group justify="center">
            <Loader size="sm" />
            <Text c="dimmed" size="sm">
              Loading notifications...
            </Text>
          </Group>
        </Paper>
      ) : items.length === 0 ? (
        <Paper withBorder radius="lg" p="md">
          <Text c="dimmed" size="sm">
            No notifications yet.
          </Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {items.map((notification) => (
            <Card key={notification.id} withBorder radius="lg" p="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group gap="xs">
                    <Badge variant="light" radius="sm">
                      {notification.templateKey}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {formatNotificationDate(notification.sentAt)}
                    </Text>
                  </Group>
                  <Text fw={600}>{notification.title}</Text>
                  {notification.body && (
                    <Text c="dimmed" size="sm">
                      {notification.body}
                    </Text>
                  )}
                </Stack>
                {notification.url && (
                  <Button
                    variant="subtle"
                    size="xs"
                    rightSection={<IconArrowRight size={14} />}
                    onClick={() => navigate(notification.url as string)}
                  >
                    Open
                  </Button>
                )}
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default NotificationsCenter;
