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
} from "@mantine/core";
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
  const reviewsState = useAppSelector((state) => state.reviews);
  const reviews = reviewsState[0]?.data?.[0]?.data ?? [];
  const nextPageToken = reviewsState[0]?.data?.[0]?.columns[0] ?? '';
  const loaderRef = useRef<HTMLDivElement | null>(null);

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


  const formatDate = (dateStr?: string) =>
    dateStr
      ? new Date(dateStr).toLocaleDateString("en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "";

  const isSuspicious = (createTime?: string, updateTime?: string) => {
    if (!createTime || !updateTime) return false;
    const created = new Date(createTime);
    const updated = new Date(updateTime);
    return created.getMonth() !== updated.getMonth() || created.getFullYear() !== updated.getFullYear();
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Text size="xl" fw={700} mb="md">
        Google Reviews
      </Text>

      <Box style={{ height: 600, overflowY: "auto" }}>
        <Table striped highlightOnHover withColumnBorders>
          <TableThead>
            <TableTr>
              <TableTh>User</TableTh>
              <TableTh>Rating</TableTh>
              <TableTh>Comment</TableTh>
              <TableTh>Creation Date</TableTh>
              <TableTh>Update Date</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {reviews.map((review, index) => (
              <TableTr key={review.reviewId || index}>
                <TableTd>
                  <Group>
                    <Avatar src={review.reviewer?.profilePhotoUrl} radius="xl" size="md" />
                    <Text fw={500}>{review.reviewer?.displayName}</Text>
                  </Group>
                </TableTd>
                <TableTd>
                  <Badge
                    color={ratingColor[review.starRating as keyof typeof ratingColor] || "gray"}
                    leftSection={<IconStarFilled size={14} />}
                  >
                    {review.starRating
                      ? review.starRating.charAt(0) + review.starRating.slice(1).toLowerCase()
                      : "Unknown"}
                  </Badge>
                </TableTd>
                <TableTd>
                  <Text size="sm" c="dimmed" lineClamp={4}>
                    {review.comment}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text size="xs" c="gray">
                    {formatDate(review.createTime)}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text size="xs" c="gray">
                    {formatDate(review.updateTime)}
                  </Text>
                </TableTd>
                <TableTd>
                  {isSuspicious(review.createTime, review.updateTime) ? (
                    <Badge color="red" >
                      Suspicious
                    </Badge>
                  ) : (
                    <Badge color="green">
                      Not Suspicious
                    </Badge>
                  )}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        <div ref={loaderRef} style={{ height: 1 }} />
      </Box>
    </Card>
  );
};

export default GoogleReviews;
