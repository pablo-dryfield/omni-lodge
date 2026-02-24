import React, { useEffect, useState } from "react";
import { Anchor, Card, Stack, Text, Title } from "@mantine/core";
import axiosInstance from "../../utils/axiosInstance";

const GET_YOUR_GUIDE_REVIEWS_URL =
  "https://www.getyourguide.com/en-gb/krakow-l40/krakow-pub-crawl-1h-open-bar-vip-entry-welcome-shots-t443425/?ranking_uuid=6bad85ec-f460-4e0a-9bb0-160af6978600";

const GetYourGuideReviews: React.FC = () => {
  const [reviewUrl, setReviewUrl] = useState(GET_YOUR_GUIDE_REVIEWS_URL);

  useEffect(() => {
    let isMounted = true;
    const loadConfiguredUrl = async () => {
      try {
        const response = await axiosInstance.get<{ url?: string }>("/reviews/getyourguideLink", {
          withCredentials: true,
        });
        const url = typeof response.data?.url === "string" ? response.data.url.trim() : "";
        if (isMounted && url.length > 0) {
          setReviewUrl(url);
        }
      } catch {
        // Keep fallback URL if configured value is unavailable.
      }
    };

    void loadConfiguredUrl();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="xs">
        <Title order={3}>GetYourGuide Reviews</Title>
        <Text>
          Check reviews here:{" "}
          <Anchor href={reviewUrl} target="_blank" rel="noreferrer">
            {reviewUrl}
          </Anchor>
        </Text>
      </Stack>
    </Card>
  );
};

export default GetYourGuideReviews;
