import { ActionIcon, Badge, Button, CopyButton, Group, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconExternalLink, IconPlayerPlay, IconSearch } from "@tabler/icons-react";
import type { StorefrontJourneyVisit } from "./StorefrontActivityTimeline";

const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{1,64}$/i.test(value);

const storefrontRecordingReferences = (visit: StorefrontJourneyVisit) => {
  const references: { projectId: string; userId: string; sessionId: string }[] = [];
  for (const event of visit.events) {
    if (event.type !== "clarity_recording_linked" || event.source !== "client") continue;
    const details = event.details;
    if (details?.environment !== "production" || !identifier(details.projectId)
      || !identifier(details.userId) || !identifier(details.sessionId)) continue;
    references.push({ projectId: details.projectId, userId: details.userId, sessionId: details.sessionId });
  }
  return references;
};

export const storefrontRecordingLinks = (visit: StorefrontJourneyVisit): string[] => [...new Set(
  storefrontRecordingReferences(visit).map(({ projectId, userId, sessionId }) =>
    `https://clarity.microsoft.com/player/${projectId}/${userId}/${sessionId}`),
)];

export const storefrontVisitorSearchLinks = (visit: StorefrontJourneyVisit): string[] => [...new Set(
  storefrontRecordingReferences(visit).map(({ projectId, userId }) =>
    `https://clarity.microsoft.com/projects/view/${projectId}/impressions?date=Last%2030%20days&UserId=is%3B${userId}`),
)];

export const StorefrontReplayLinks = ({ visit }: { visit: StorefrontJourneyVisit }) => {
  const links = storefrontRecordingLinks(visit);
  const searchLinks = storefrontVisitorSearchLinks(visit);
  const lookupId = visit.claritySampled && /^[0-9a-f-]{36}$/i.test(visit.id) ? visit.id : null;
  return (
    <Group gap={6} wrap="wrap">
      {links.map((url, index) => (
        <Tooltip key={url} multiline w={280} label="Open the captured reference in Clarity. A native reference does not confirm recording upload or retention.">
          <Button component="a" href={url} target="_blank" rel="noopener noreferrer" size="xs" variant="light"
            leftSection={<IconPlayerPlay size={14} />} rightSection={<IconExternalLink size={12} />}>
            {links.length === 1 ? "Clarity" : `Clarity ${index + 1}`}
          </Button>
        </Tooltip>
      ))}
      {searchLinks.map(url => (
        <Tooltip key={url} multiline w={280} label="Find visitor in Clarity. A native reference does not confirm recording upload or retention.">
          <ActionIcon component="a" href={url} target="_blank" rel="noopener noreferrer" size="sm" variant="subtle"
            aria-label="Find visitor in Clarity">
            <IconSearch size={14} />
          </ActionIcon>
        </Tooltip>
      ))}
      {!links.length && (
        <Tooltip label={lookupId ? "Replay was requested, not confirmed. Use the copied ID in Clarity's Custom session ID filter." : "No recording reference was captured for this visit."}>
          <Badge size="sm" variant="light" color="gray">{lookupId ? "Lookup only" : "No recording link"}</Badge>
        </Tooltip>
      )}
      {lookupId && (
        <CopyButton value={lookupId}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Visit ID copied" : "Copy Clarity custom session ID"}>
              <ActionIcon size="sm" variant="subtle" color={copied ? "teal" : "gray"} onClick={copy}
                aria-label={copied ? "Visit ID copied" : "Copy Clarity custom session ID"}>
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      )}
    </Group>
  );
};
