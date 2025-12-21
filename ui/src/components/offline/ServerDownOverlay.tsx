import React, { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Group, Loader, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import DinoGame from "./DinoGame";
import axiosInstance from "../../utils/axiosInstance";

type ServerDownOverlayProps = {
  status?: number;
  onRetry?: () => void;
  isChecking?: boolean;
  mode?: "server-down" | "freeplay";
  onClose?: () => void;
  isAuthenticated?: boolean;
};

type LeaderboardEntry = {
  rank: number;
  userId: number;
  displayName: string;
  score: number;
};

const LEADERBOARD_ROWS = 10;
const LEADERBOARD_COLUMNS = 2;
const LEADERBOARD_ROW_HEIGHT = 16;

const ServerDownOverlay = ({
  status,
  onRetry,
  isChecking,
  mode = "server-down",
  onClose,
  isAuthenticated = false,
}: ServerDownOverlayProps) => {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const isServerDown = mode === "server-down";
  const title = isServerDown ? "OmniLodge server is unavailable" : "KTK Runner";
  const subtitle = isServerDown ? "While we reconnect, enjoy the offline runner." : "Play the KTK Krakow runner anytime.";
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [isSavingScore, setIsSavingScore] = useState(false);
  const saveInFlightRef = useRef(false);

  const columnCount = isMobile ? 1 : LEADERBOARD_COLUMNS;
  const rowsPerColumn = Math.ceil(LEADERBOARD_ROWS / columnCount);
  const leaderboardHeight = rowsPerColumn * LEADERBOARD_ROW_HEIGHT;

  const fetchLeaderboard = useCallback(async () => {
    if (isServerDown) {
      return;
    }
    setLoadingScores(true);
    setScoreError(null);
    try {
      const response = await axiosInstance.get<LeaderboardEntry[]>("/gameScores/leaderboard");
      setLeaderboard(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Failed to load leaderboard", error);
      setScoreError("Leaderboard is unavailable right now.");
    } finally {
      setLoadingScores(false);
    }
  }, [isServerDown]);

  useEffect(() => {
    if (!isServerDown) {
      void fetchLeaderboard();
    }
  }, [fetchLeaderboard, isServerDown]);

  const handleGameOver = useCallback(
    async (score: number) => {
      if (isServerDown || !isAuthenticated) {
        return;
      }
      if (saveInFlightRef.current) {
        return;
      }
      saveInFlightRef.current = true;
      setIsSavingScore(true);
      try {
        await axiosInstance.post("/gameScores", { score });
        await fetchLeaderboard();
      } catch (error) {
        console.error("Failed to submit score", error);
      } finally {
        saveInFlightRef.current = false;
        setIsSavingScore(false);
      }
    },
    [fetchLeaderboard, isAuthenticated, isServerDown]
  );

  const renderLeaderboardBody = () => {
    if (isServerDown) {
      return (
        <Box style={{ minHeight: leaderboardHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text size="sm" c="dimmed">
            Leaderboard is unavailable offline.
          </Text>
        </Box>
      );
    }
    if (loadingScores) {
      return (
        <Box style={{ minHeight: leaderboardHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader size="sm" />
        </Box>
      );
    }
    if (scoreError) {
      return (
        <Box style={{ minHeight: leaderboardHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text size="sm" c="dimmed">
            {scoreError}
          </Text>
        </Box>
      );
    }
    if (leaderboard.length === 0) {
      return (
        <Box style={{ minHeight: leaderboardHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text size="sm" c="dimmed">
            No scores yet. Be the first!
          </Text>
        </Box>
      );
    }
    const columns: LeaderboardEntry[][] = [];
    for (let i = 0; i < columnCount; i += 1) {
      columns.push(leaderboard.slice(i * rowsPerColumn, (i + 1) * rowsPerColumn));
    }
    return (
      <ScrollArea h={leaderboardHeight} type="auto" offsetScrollbars>
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: columnCount === 1 ? "1fr" : "1fr 1fr",
            columnGap: columnCount === 1 ? 0 : 16,
            paddingRight: 8,
          }}
        >
          {columns.map((column, columnIndex) => (
            <Stack key={`score-col-${columnIndex}`} gap={6}>
              {column.map((entry) => (
                <Group
                  key={`${entry.userId}-${entry.rank}`}
                  justify="space-between"
                  align="flex-start"
                  style={{ minHeight: LEADERBOARD_ROW_HEIGHT }}
                >
                  <Text size="sm" fw={600} style={{ width: 34 }}>
                    #{entry.rank}
                  </Text>
                  <Text size="xs" style={{ flex: 1, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    {entry.displayName}
                  </Text>
                  <Text size="sm" fw={600} style={{ minWidth: 44, textAlign: "right" }}>
                    {entry.score}
                  </Text>
                </Group>
              ))}
            </Stack>
          ))}
        </Box>
      </ScrollArea>
    );
  };

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
          <DinoGame onGameOver={handleGameOver} />
        </Box>

        <Box style={{ padding: "0 16px" }}>
          <Box
            style={{
              maxWidth: 520,
              width: "100%",
              background: "transparent",
              border: "1px solid rgba(124, 63, 28, 0.2)",
              borderRadius: 7,
              padding: 5,
              boxShadow: "none",
            }}
          >
            <Group justify="space-between" align="center" style={{ marginBottom: 8 }}>
              <Title order={6}>Scoreboard</Title>
              <Badge color="orange" variant="light" size="sm">
                Top 10
              </Badge>
            </Group>
            {renderLeaderboardBody()}
            <Group justify="space-between" align="center" style={{ marginTop: 4 }}>
              <Text size="xs" c="dimmed">
                {isServerDown
                  ? "Scores save once the server is back."
                  : isAuthenticated
                  ? "Scores save on game over."
                  : "Log in to save your score."}
              </Text>
              {isSavingScore && (
                <Text size="xs" c="dimmed">
                  Saving...
                </Text>
              )}
            </Group>
          </Box>
        </Box>

        <Text size="sm" c="dimmed" style={{ padding: "0 16px 16px" }}>
          Tip: Space, Arrow Up, or tap to jump. Arrow Down to crouch; on mobile, hold tap to crouch.
        </Text>
      </Stack>
    </Box>
  );
};

export default ServerDownOverlay;
