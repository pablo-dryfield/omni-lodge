import React, { useEffect } from "react";
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
  THREE: "yellow",
  FOUR: "blue",
  FIVE: "green",
};

const TripAdvisorReviews: React.FC = () => {
  const dispatch = useAppDispatch();
  const reviewsState = useAppSelector((state) => state.reviews.tripadvisor);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const tripAdvisorState = reviewsState?.[0];
  const reviews = tripAdvisorState?.data?.[0]?.data ?? [];

  useEffect(() => {
    if (!tripAdvisorState?.loading && reviews.length === 0) {
      dispatch(fetchTripAdvisorReviews());
    }
  }, [dispatch, tripAdvisorState?.loading, reviews.length]);

  const renderRatingBadge = (starRating?: string) => (
    <Badge
      color={ratingColor[starRating as keyof typeof ratingColor] || "gray"}
      leftSection={<IconStarFilled size={14} />}
      variant="light"
    >
      {starRating ? starRating.charAt(0) + starRating.slice(1).toLowerCase() : "Unknown"}
    </Badge>
  );

  const renderStatusBadge = (date?: string) =>
    date ? (
      <Badge color="green" variant="light">
        Verified
      </Badge>
    ) : (
      <Badge color="yellow" variant="light">
        Undated
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
            <TableTh style={{ minWidth: 170 }}>Date</TableTh>
            <TableTh style={{ minWidth: 130 }}>Status</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {reviews.map((review, index) => (
            <TableTr key={review.reviewId || index}>
              <TableTd>
                <Group gap="sm">
                  <Avatar src={review.reviewer?.profilePhotoUrl} radius="xl" size="md" />
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
                  {review.createTime ? new Date(review.createTime).toLocaleDateString() : "—"}
                </Text>
              </TableTd>
              <TableTd>{renderStatusBadge(review.createTime)}</TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
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
                <Text fw={600}>{review.reviewer?.displayName ?? "TripAdvisor guest"}</Text>
                <Text size="xs" c="dimmed">
                  {review.createTime ? new Date(review.createTime).toLocaleDateString() : ""}
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
                Added {review.updateTime ? new Date(review.updateTime).toLocaleDateString() : "-"}
              </Text>
            </Stack>
            {renderStatusBadge(review.createTime)}
          </Group>
        </Paper>
      ))}
    </Stack>
  );

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={3}>TripAdvisor Reviews</Title>
            <Text size="sm" c="dimmed">
              Latest TripAdvisor comments gathered via automated scraping. Use this feed to spot patterns that
              differ from Google feedback.
            </Text>
          </div>
          <Badge variant="outline" color="teal">
            Scraped feed
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
