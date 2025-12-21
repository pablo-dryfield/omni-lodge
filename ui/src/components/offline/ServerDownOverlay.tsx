import React from "react";
import { Badge, Box, Button, Group, Stack, Text, Title } from "@mantine/core";
import DinoGame from "./DinoGame";

type ServerDownOverlayProps = {
  status?: number;
  onRetry: () => void;
  isChecking?: boolean;
};

const ServerDownOverlay = ({ status, onRetry, isChecking }: ServerDownOverlayProps) => {
  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "linear-gradient(135deg, #f8f4ed 0%, #fef3c7 40%, #fde68a 100%)",
        padding: "16px",
        overflow: "hidden",
      }}
    >
      <Stack gap="md" style={{ height: "100%" }}>
        <Group justify="space-between" align="center">
          <Stack gap={4}>
            <Title order={2}>OmniLodge server is unavailable</Title>
            <Text size="sm" c="dimmed">
              While we reconnect, enjoy the offline runner.
            </Text>
          </Stack>
          <Group gap="sm">
            <Badge color="orange" size="lg" variant="light">
              {status ? `Status ${status}` : "Connection lost"}
            </Badge>
            <Button onClick={onRetry} loading={isChecking} variant="outline" color="dark">
              Retry connection
            </Button>
          </Group>
        </Group>

        <Box style={{ flex: 1, display: "flex", alignItems: "center" }}>
          <DinoGame />
        </Box>

        <Text size="sm" c="dimmed">
          Tip: Space, Arrow Up, or tap to jump.
        </Text>
      </Stack>
    </Box>
  );
};

export default ServerDownOverlay;
