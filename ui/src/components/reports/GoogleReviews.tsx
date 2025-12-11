import React, { useEffect, useRef } from "react";
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
import { fetchGoogleReviews } from "../../actions/reviewsActions";
import { useAppDispatch, useAppSelector } from "../../store/hooks";

const ratingColor = {
  ONE: "red",
  TWO: "red",
  THREE: "red",
  FOUR: "blue",
  FIVE: "green",
};

const GoogleReviews: React.FC = () => {
  const dispatch = useAppDispatch();
  const reviewsState = useAppSelector((state) => state.reviews.google);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const googleState = reviewsState?.[0];
  const reviews = googleState?.data?.[0]?.data ?? [];
  const nextPageToken = googleState?.data?.[0]?.columns?.[0] ?? "";

  useEffect(() => {
    dispatch(fetchGoogleReviews({}));
  }, [dispatch]);

  useEffect(() => {
  const currentRef = loaderRef.current;

  const observer = new IntersectionObserver(
    (entries) => {
      const first = entries[0];
      if (first.isIntersecting && nextPageToken) {
        dispatch(fetchGoogleReviews({ nextPageToken }));
      }
    },
    { threshold: 1.0 }
  );

  if (currentRef) {
    observer.observe(currentRef);
  }

  return () => {
    if (currentRef) {
      observer.unobserve(currentRef);
    }
  };
}, [dispatch, nextPageToken]);


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
          {reviews.map((review, index) => (
            <TableTr key={review.reviewId || index}>
              <TableTd>
                <Group gap="sm">
                  <Avatar src={review.reviewer?.profilePhotoUrl} radius="xl" size="md" />
                  <Text fw={500}>{review.reviewer?.displayName ?? "Anonymous guest"}</Text>
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
      {reviews.map((review, index) => (
        <Paper key={review.reviewId || index} withBorder radius="md" p="md" shadow="xs">
          <Group justify="space-between" align="flex-start">
            <Group gap="sm" align="flex-start">
              <Avatar src={review.reviewer?.profilePhotoUrl} radius="xl" size="md" />
              <Stack gap={2}>
                <Text fw={600}>{review.reviewer?.displayName ?? "Anonymous guest"}</Text>
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
                Updated {formatDate(review.updateTime) || "—"}
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
            <Title order={3}>Google Reviews</Title>
            <Text size="sm" c="dimmed">
              Real-time sentiment directly from Google so you can read every word guests share about your experience.
            </Text>
          </div>
          <Badge variant="light" color="indigo">
            Live feed
          </Badge>
        </Group>
        {googleState?.loading ? (
          <Text size="sm" c="dimmed">
            Loading Google reviews...
          </Text>
        ) : googleState?.error ? (
          <Text size="sm" c="red">
            {googleState.error}
          </Text>
        ) : reviews.length === 0 ? (
          <Text size="sm" c="dimmed">
            No reviews available yet.
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

export default GoogleReviews;
