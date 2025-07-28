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
  ScrollArea,
  Badge,
  Text,
  Group,
  Box,
} from "@mantine/core";
import { IconStarFilled } from "@tabler/icons-react";
import { fetchGoogleReviews } from "../../actions/reviewsActions";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { Review } from "../../types/general/Reviews";

const ratingColor = {
  ONE: "red",
  TWO: "orange",
  THREE: "yellow",
  FOUR: "lime",
  FIVE: "green",
};

const GoogleReviews: React.FC<any> = () => {

  const dispatch = useAppDispatch();
  const reviewsState = useAppSelector((state) => state.reviews);
  const reviews = reviewsState[0]?.data?.[0]?.data ?? [];

  useEffect(() => {
    dispatch(fetchGoogleReviews())
  }, [dispatch]);

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Text size="xl" fw={700} mb="md">
        Google Reviews
      </Text>

      <ScrollArea h={600} type="auto">
        <Table striped highlightOnHover withColumnBorders>
          <TableThead>
            <TableTr>
              <TableTh>User</TableTh>
              <TableTh>Rating</TableTh>
              <TableTh>Comment</TableTh>
              <TableTh>Date</TableTh>
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
                    variant="light"
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
                    {review.createTime &&
                      new Date(review.createTime).toLocaleDateString("en-GB", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: '2-digit', 
                        minute:'2-digit',
                        second: '2-digit'
                      })}
                  </Text>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </ScrollArea>
    </Card>
  );
};

export default GoogleReviews;
