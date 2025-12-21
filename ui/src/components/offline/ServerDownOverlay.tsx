import React from "react";
import { Badge, Box, Button, Group, Stack, Text, Title } from "@mantine/core";
import DinoGame from "./DinoGame";

type ServerDownOverlayProps = {
  status?: number;
  onRetry?: () => void;
  isChecking?: boolean;
  mode?: "server-down" | "freeplay";
  onClose?: () => void;
};

const ServerDownOverlay = ({ status, onRetry, isChecking, mode = "server-down", onClose }: ServerDownOverlayProps) => {
  const isServerDown = mode === "server-down";
  const title = isServerDown ? "OmniLodge server is unavailable" : "OmniLodge Runner";
  const subtitle = isServerDown ? "While we reconnect, enjoy the offline runner." : "Play the Krakow runner anytime.";
  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "linear-gradient(135deg, #f8f4ed 0%, #fef3c7 40%, #fde68a 100%)",
        padding: 0,
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
    >
      <Stack gap="md" style={{ height: "100%", width: "100%" }}>
        <Group justify="space-between" align="center" style={{ padding: "16px" }}>
          <Stack gap={4}>
            <Title order={2}>{title}</Title>
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          </Stack>
          <Group gap="sm">
            {isServerDown && (
              <Badge color="orange" size="lg" variant="light">
                {status ? `Status ${status}` : "Connection lost"}
              </Badge>
            )}
            {isServerDown ? (
              <Button onClick={onRetry} loading={isChecking} variant="outline" color="dark">
                Retry connection
              </Button>
            ) : (
              <Button onClick={onClose} variant="outline" color="dark">
                Back to app
              </Button>
            )}
          </Group>
        </Group>

        <Box style={{ flex: 1, display: "flex", alignItems: "center", width: "100vw", overflow: "hidden" }}>
          <DinoGame />
        </Box>

        <Text size="sm" c="dimmed" style={{ padding: "0 16px 16px" }}>
          Tip: Space, Arrow Up, or tap to jump.
        </Text>
      </Stack>
    </Box>
  );
};

export default ServerDownOverlay;
