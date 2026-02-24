import React, { useEffect } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Paper,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconStarFilled } from "@tabler/icons-react";
import { fetchAirbnbReviews } from "../../actions/reviewsActions";
import { useAppDispatch, useAppSelector } from "../../store/hooks";

const ratingColor = {
  ONE: "red",
  TWO: "red",
  THREE: "orange",
  FOUR: "blue",
  FIVE: "green",
};

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

const AirbnbReviews: React.FC = () => {
  const dispatch = useAppDispatch();
  const reviewsState = useAppSelector((state) => state.reviews.airbnb);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const airbnbState = reviewsState?.[0];
  const reviews = airbnbState?.data?.[0]?.data ?? [];
  const metadata = airbnbState?.data?.[0]?.columns?.[0] as
    | {
        cursorUsed?: string | null;
        endCursor?: string | null;
        totalCount?: number;
        hasMore?: boolean;
      }
    | undefined;

  useEffect(() => {
    if (!airbnbState?.loading && reviews.length === 0) {
      dispatch(fetchAirbnbReviews({}));
    }
  }, [airbnbState?.loading, dispatch, reviews.length]);

  const renderRatingBadge = (starRating?: string) => (
    <Badge
      color={ratingColor[starRating as keyof typeof ratingColor] || "gray"}
      leftSection={<IconStarFilled size={14} />}
      variant="light"
    >
      {starRating ? starRating.charAt(0) + starRating.slice(1).toLowerCase() : "Unknown"}
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
          </TableTr>
        </TableThead>
        <TableTbody>
          {reviews.map((review, index) => (
            <TableTr key={review.reviewId || index}>
              <TableTd>
                <Group gap="sm">
                  <Avatar
                    src={review.reviewer?.profilePhotoUrl}
                    radius="xl"
                    size="md"
                    imageProps={{ referrerPolicy: "no-referrer" }}
                  />
                  <Text fw={500}>{review.reviewer?.displayName ?? "Airbnb guest"}</Text>
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
              <Avatar
                src={review.reviewer?.profilePhotoUrl}
                radius="xl"
                size="md"
                imageProps={{ referrerPolicy: "no-referrer" }}
              />
              <Stack gap={2}>
                <Text fw={600}>{review.reviewer?.displayName ?? "Airbnb guest"}</Text>
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
        </Paper>
      ))}
    </Stack>
  );

  const handleLoadMore = () => {
    if (airbnbState?.loading || !metadata?.endCursor) return;
    dispatch(fetchAirbnbReviews({ cursor: metadata.endCursor }));
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={3}>Airbnb Reviews</Title>
          </div>
          <Badge variant="light" color="teal">
            Live feed
          </Badge>
        </Group>
        {airbnbState?.loading ? (
          <Text size="sm" c="dimmed">
            Loading Airbnb reviews...
          </Text>
        ) : airbnbState?.error ? (
          <Text size="sm" c="red">
            {airbnbState.error}
          </Text>
        ) : reviews.length === 0 ? (
          <Text size="sm" c="dimmed">
            No Airbnb reviews available yet.
          </Text>
        ) : isMobile ? (
          mobileCards
        ) : (
          desktopTable
        )}
        <Group justify="center">
          <Badge variant="light" color="gray">
            Showing {reviews.length}
            {metadata?.totalCount ? ` of ${metadata.totalCount}` : ""} reviews
          </Badge>
        </Group>
        {metadata?.hasMore && (
          <Group justify="center">
            <Button onClick={handleLoadMore} loading={airbnbState?.loading} variant="light">
              Load more reviews
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
};

export default AirbnbReviews;
