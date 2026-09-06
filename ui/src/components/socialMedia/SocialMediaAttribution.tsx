import { Avatar, Box, Stack, Text, Tooltip } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import type { SocialMediaContentItem, SocialMediaContentPerson } from "../../api/socialMedia";
import { buildUserProfilePhotoUrl } from "../../utils/profilePhoto";
import { SOCIAL_MEDIA_PUBLICATION_TIMEZONE } from "../../utils/socialMediaBoardState";

export const socialMediaPersonName = (
  person: SocialMediaContentPerson | null | undefined,
  fallback?: string | null,
): string => [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim()
  || person?.username
  || fallback
  || (person?.id ? `User #${person.id}` : "Not yet");

const dateParts = (value: string | null): { date: string; time: string } | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    date: new Intl.DateTimeFormat("en-GB", {
      timeZone: SOCIAL_MEDIA_PUBLICATION_TIMEZONE,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(parsed),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: SOCIAL_MEDIA_PUBLICATION_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed),
  };
};

const SocialMediaAttribution = ({ item }: { item: SocialMediaContentItem }) => {
  const people = [
    {
      label: "Created",
      person: item.createdByUser,
      name: socialMediaPersonName(item.createdByUser, item.createdByName || "Not recorded"),
      timestamp: item.createdAt,
      color: "blue",
    },
    {
      label: "Produced",
      person: item.producedByUser,
      name: socialMediaPersonName(item.producedByUser, item.producedByName
        || (item.producedBy ? `User #${item.producedBy}` : item.productionStartedAt ? "Not recorded" : null)),
      timestamp: item.productionStartedAt,
      color: "violet",
    },
    {
      label: "Published",
      person: item.publishedByUser,
      name: socialMediaPersonName(item.publishedByUser, item.publishedByName
        || (item.publishedBy ? `User #${item.publishedBy}` : item.publishedAt ? "Not recorded" : null)),
      timestamp: item.publishedAt,
      color: "teal",
    },
  ];

  return (
    <Box
      aria-label="Content contributors"
      py="sm"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 6,
        borderTop: "1px solid var(--mantine-color-gray-2)",
        borderBottom: "1px solid var(--mantine-color-gray-2)",
      }}
    >
      {people.map(({ label, person, name, timestamp, color }) => {
        const date = dateParts(timestamp);
        const initials = ["Not yet", "Not recorded"].includes(name) ? "" : name.split(/\s+/u).slice(0, 2)
          .map((part) => part[0]).join("").toUpperCase();
        return (
          <Tooltip
            key={label}
            label={`${label}: ${name}${date ? ` · ${date.date}, ${date.time} (Warsaw)` : ""}`}
            multiline
            maw={240}
            withArrow
            events={{ hover: true, focus: true, touch: true }}
          >
            <Stack gap={3} align="center" style={{ minWidth: 0 }}>
              <Text size="10px" fw={700} tt="uppercase" c="dimmed">{label}</Text>
              <Avatar
                src={buildUserProfilePhotoUrl({
                  user: person,
                  resourcePath: person ? `/social-media/users/${person.id}/profile-photo` : undefined,
                }) ?? undefined}
                alt={name === "Not yet" ? `${label}: not yet assigned` : name}
                size={38}
                radius="xl"
                color={color}
                style={{ border: `2px solid var(--mantine-color-${color}-1)` }}
              >
                {initials || <IconUser size={17} />}
              </Avatar>
              <Text size="xs" fw={600} ta="center" lineClamp={2} w="100%" mih={32}>{name}</Text>
              {date ? (
                <Text size="10px" c="dimmed" ta="center" lh={1.4}>
                  {date.date}<br />{date.time}
                </Text>
              ) : null}
            </Stack>
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default SocialMediaAttribution;
