import React, { useCallback, useEffect, useState } from "react";
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
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight, IconRefresh } from "@tabler/icons-react";
import {
  fetchInboxNotifications,
  type InboxNotification,
} from "../api/notifications";

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

const NotificationsCenter: React.FC<NotificationsCenterProps> = ({ title }) => {
  const navigate = useNavigate();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (title) {
      document.title = title;
    }
  }, [title]);

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
