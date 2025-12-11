import React, { useEffect, useState } from "react";
import {
  Button,
  Avatar,
  Badge,
  Box,
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
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchGetYourGuideReviews } from "../../actions/reviewsActions";

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

const GetYourGuideReviews: React.FC = () => {
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [requestedLimit, setRequestedLimit] = useState(40);
  const gygState = useAppSelector((state) => state.reviews.getyourguide);
  const reviews = gygState?.[0]?.data?.[0]?.data ?? [];
  const metadata = gygState?.[0]?.data?.[0]?.columns?.[0] as
    | {
        lastFetched?: number;
        fromCache?: boolean;
        cacheTtlMs?: number;
        limit?: number;
        requestedLimit?: number | null;
        maxLimit?: number;
        minLimit?: number;
      }
    | undefined;
  const loading = gygState?.[0]?.loading;
  const error = gygState?.[0]?.error;
  const maxLimit = metadata?.maxLimit ?? 150;
  const limitInUse = metadata?.limit ?? requestedLimit;

  useEffect(() => {
    dispatch(fetchGetYourGuideReviews({ limit: requestedLimit }));
  }, [dispatch, requestedLimit]);

  const handleRetry = (forceRefresh?: boolean) => {
    dispatch(fetchGetYourGuideReviews({ limit: requestedLimit, forceRefresh }));
  };

  const handleLoadMore = () => {
    setRequestedLimit((prev) => Math.min(prev + 20, maxLimit));
  };

  const lastFetchedLabel = metadata?.lastFetched
    ? formatDate(new Date(metadata.lastFetched).toISOString())
    : null;
  const cacheTtlMinutes =
    metadata?.cacheTtlMs && metadata.cacheTtlMs >= 60000
      ? Math.round(metadata.cacheTtlMs / 60000)
      : null;

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
                  <Text fw={500}>{review.reviewer?.displayName ?? "GetYourGuide traveler"}</Text>
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
                <Text fw={600}>{review.reviewer?.displayName ?? "GetYourGuide traveler"}</Text>
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

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={3}>GetYourGuide Reviews</Title>
          </div>
          <Badge variant="light" color="teal">
            Live feed
          </Badge>
        </Group>
        {loading ? (
          <Text size="sm" c="dimmed">
            Loading GetYourGuide reviews...
          </Text>
        ) : error ? (
          <Stack gap="xs">
            <Text size="sm" c="red">
              {error}
            </Text>
            <Button onClick={() => handleRetry(true)} variant="light" size="xs" loading={loading}>
              Retry loading reviews
            </Button>
          </Stack>
        ) : reviews.length === 0 ? (
          <Text size="sm" c="dimmed">
            No GetYourGuide reviews available yet.
          </Text>
        ) : isMobile ? (
          mobileCards
        ) : (
          desktopTable
        )}
        <Group justify="center">
          <Badge variant="light" color="gray">
            Showing {reviews.length}
            {metadata?.limit ? ` of ${metadata.limit}` : ""} requested reviews
          </Badge>
        </Group>
        {limitInUse < maxLimit && (
          <Group justify="center">
            <Button
              onClick={handleLoadMore}
              loading={loading}
              variant="light"
              disabled={limitInUse >= maxLimit}
            >
              {limitInUse >= maxLimit ? "Maximum loaded" : "Load more reviews"}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
};

export default GetYourGuideReviews;
