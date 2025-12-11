import React, { useEffect, useRef, useState } from "react";
import {
  Card,
  Avatar,
  Table,
  TableThead,
  TableTr,
  TableTh,
  TableTd,
  TableTbody,
  Badge,
  Text,
  Group,
  Box,
  Stack,
  Paper,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconStarFilled } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchTripAdvisorReviews } from "../../actions/reviewsActions";

const ratingColor = {
  ONE: "red",
  TWO: "red",
  THREE: "red",
  FOUR: "blue",
  FIVE: "green",
};

const INITIAL_VISIBLE_COUNT = 40;
const VISIBLE_BATCH_SIZE = 40;

const TripAdvisorReviews: React.FC = () => {
  const dispatch = useAppDispatch();
  const reviewsState = useAppSelector((state) => state.reviews.tripadvisor);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const tripAdvisorState = reviewsState?.[0];
  const reviews = tripAdvisorState?.data?.[0]?.data ?? [];

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const visibleReviews = reviews.slice(0, visibleCount);

  useEffect(() => {
    if (!tripAdvisorState?.loading && reviews.length === 0) {
      dispatch(fetchTripAdvisorReviews());
    }
  }, [dispatch, tripAdvisorState?.loading, reviews.length]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [reviews.length]);

  useEffect(() => {
    const sentinel = loaderRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && visibleCount < reviews.length) {
          setVisibleCount((prev) => Math.min(prev + VISIBLE_BATCH_SIZE, reviews.length));
        }
      },
      { threshold: 1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, reviews.length]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const hasTime =
      date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: hasTime ? "2-digit" : undefined,
      minute: hasTime ? "2-digit" : undefined,
      second: hasTime ? "2-digit" : undefined,
      timeZone: "UTC",
    });
  };

  const isSuspicious = (createTime?: string, updateTime?: string) => {
    if (!createTime || !updateTime) return false;
    const created = new Date(createTime);
    const updated = new Date(updateTime);
    return created.getMonth() !== updated.getMonth() || created.getFullYear() !== updated.getFullYear();
  };

  const renderRatingBadge = (starRating?: string) => (
    <Badge
      color={ratingColor[starRating as keyof typeof ratingColor] || "gray"}
      leftSection={<IconStarFilled size={14} />}
      variant="light"
    >
      {starRating ? starRating.charAt(0) + starRating.slice(1).toLowerCase() : "Unknown"}
    </Badge>
  );

  const renderStatusBadge = (createTime?: string, updateTime?: string) =>
    isSuspicious(createTime, updateTime) ? (
      <Badge color="red" variant="filled">
        Suspicious
      </Badge>
    ) : (
      <Badge color="green" variant="light">
        Not Suspicious
      </Badge>
    );

  const desktopTable = (
    <Box style={{ maxHeight: 520, overflowY: "auto" }}>
      <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
        <TableThead>
          <TableTr>
            <TableTh style={{ minWidth: 160 }}>User</TableTh>
            <TableTh style={{ minWidth: 110 }}>Rating</TableTh>
            <TableTh>Comment</TableTh>
            <TableTh style={{ minWidth: 170 }}>Creation Date</TableTh>
            <TableTh style={{ minWidth: 170 }}>Update Date</TableTh>
            <TableTh style={{ minWidth: 130 }}>Status</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {visibleReviews.map((review, index) => (
            <TableTr key={review.reviewId || index}>
              <TableTd>
                <Group gap="sm">
                  <Avatar
                    src={review.reviewer?.profilePhotoUrl}
                    radius="xl"
                    size="md"
                    imageProps={{ referrerPolicy: "no-referrer" }}
                  />
                  <Text fw={500}>{review.reviewer?.displayName ?? "TripAdvisor guest"}</Text>
                </Group>
              </TableTd>
              <TableTd>{renderRatingBadge(review.starRating)}</TableTd>
              <TableTd>
                <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                  {review.comment || "No written comment provided."}
                </Text>
              </TableTd>
              <TableTd>
                <Text size="xs" c="gray.6">
                  {formatDate(review.createTime)}
                </Text>
              </TableTd>
              <TableTd>
                <Text size="xs" c="gray.6">
                  {formatDate(review.updateTime)}
                </Text>
              </TableTd>
              <TableTd>{renderStatusBadge(review.createTime, review.updateTime)}</TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
      <div ref={loaderRef} style={{ height: 1 }} />
    </Box>
  );

  const mobileCards = (
    <Stack gap="sm">
      {visibleReviews.map((review, index) => (
        <Paper key={review.reviewId || index} withBorder radius="md" p="md" shadow="xs">
          <Group justify="space-between" align="flex-start">
            <Group gap="sm" align="flex-start">
              <Avatar
                src={review.reviewer?.profilePhotoUrl}
                radius="xl"
                size="md"
                imageProps={{ referrerPolicy: "no-referrer" }}
              />
              <Stack gap={2}>
                <Text fw={600}>{review.reviewer?.displayName ?? "TripAdvisor guest"}</Text>
                <Text size="xs" c="dimmed">
                  {formatDate(review.createTime)}
                </Text>
              </Stack>
            </Group>
            {renderRatingBadge(review.starRating)}
          </Group>
          <Text size="sm" mt="sm" style={{ whiteSpace: "pre-wrap" }}>
            {review.comment || "No written comment provided."}
          </Text>
          <Group justify="space-between" mt="sm" align="flex-start" gap="xs">
            <Stack gap={2}>
              <Text size="xs" c="gray.6">
                Updated {formatDate(review.updateTime) || "-"}
              </Text>
            </Stack>
            {renderStatusBadge(review.createTime, review.updateTime)}
          </Group>
        </Paper>
      ))}
      <div ref={loaderRef} style={{ height: 1 }} />
    </Stack>
  );

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={3}>TripAdvisor Reviews</Title>
            <Text size="sm" c="dimmed">
              Mirrors the Google layout so both feeds feel consistent while you scroll through the full TripAdvisor history.
            </Text>
          </div>
          <Badge variant="light" color="teal">
            Live feed
          </Badge>
        </Group>
        {tripAdvisorState?.loading ? (
          <Text size="sm" c="dimmed">
            Loading TripAdvisor reviews...
          </Text>
        ) : tripAdvisorState?.error ? (
          <Text size="sm" c="red">
            {tripAdvisorState.error}
          </Text>
        ) : reviews.length === 0 ? (
          <Text size="sm" c="dimmed">
            No TripAdvisor reviews available yet.
          </Text>
        ) : isMobile ? (
          mobileCards
        ) : (
          desktopTable
        )}
      </Stack>
    </Card>
  );
};

export default TripAdvisorReviews;
