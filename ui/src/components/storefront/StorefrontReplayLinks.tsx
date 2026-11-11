import { ActionIcon, Badge, Button, CopyButton, Group, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconExternalLink, IconPlayerPlay } from "@tabler/icons-react";
import type { StorefrontJourneyVisit } from "./StorefrontActivityTimeline";

const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{1,64}$/i.test(value);

export const storefrontRecordingLinks = (visit: StorefrontJourneyVisit): string[] => {
  const urls = new Set<string>();
  for (const event of visit.events) {
    if (event.type !== "clarity_recording_linked" || event.source !== "client") continue;
    const details = event.details;
    if (details?.environment !== "production" || !identifier(details.projectId)
      || !identifier(details.userId) || !identifier(details.sessionId)) continue;
    urls.add(`https://clarity.microsoft.com/player/${details.projectId}/${details.userId}/${details.sessionId}`);
  }
  return [...urls];
};

export const StorefrontReplayLinks = ({ visit }: { visit: StorefrontJourneyVisit }) => {
  const links = storefrontRecordingLinks(visit);
  const lookupId = visit.claritySampled && /^[0-9a-f-]{36}$/i.test(visit.id) ? visit.id : null;
  return (
    <Group gap={6} wrap="wrap">
      {links.map((url, index) => (
        <Tooltip key={url} label="Open in Clarity. Recordings may still be processing or may have expired.">
          <Button component="a" href={url} target="_blank" rel="noopener noreferrer" size="xs" variant="light"
            leftSection={<IconPlayerPlay size={14} />} rightSection={<IconExternalLink size={12} />}>
            {links.length === 1 ? "Clarity" : `Clarity ${index + 1}`}
          </Button>
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
