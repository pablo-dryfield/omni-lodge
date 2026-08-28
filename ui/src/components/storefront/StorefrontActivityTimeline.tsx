import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBrowser, IconClock, IconDeviceDesktopAnalytics } from "@tabler/icons-react";
import dayjs from "dayjs";

export type StorefrontJourneyEvent = {
  id: string;
  type: string;
  source: "client" | "server" | "stripe" | string;
  severity: "info" | "warning" | "error" | string;
  sequence: number | null;
  occurredAt: string;
  receivedAt: string;
  details: Record<string, unknown> | null;
};

export type StorefrontJourneyVisit = {
  id: string;
  browserInstanceId: string | null;
  startedAt: string;
  lastActivityAt: string;
  qualifiedAt: string;
  claritySampled: boolean;
  claritySessionId: string | null;
  events: StorefrontJourneyEvent[];
};

type StorefrontActivityTimelineProps = {
  visits: StorefrontJourneyVisit[];
  emptyMessage?: string;
};

const eventValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const storefrontJourneyEventDescription = (event: StorefrontJourneyEvent): string => {
  const details = event.details || {};
  const product = eventValue(details.productName || details.productSlug || "experience");
  const previous = eventValue(details.previousValue);
  const next = eventValue(details.newValue);
  const participant = eventValue(details.participantType).replace("participants", "guests");
  const addon = eventValue(details.addonName || "Add-on");
  const descriptions: Record<string, string> = {
    product_viewed: `Viewed ${product}`,
    booking_builder_reached: "Build Your Booking reached",
    participant_changed: `${participant} changed from ${previous} to ${next}`,
    experience_date_changed: `Activity date changed from ${previous || "not selected"} to ${next}`,
    experience_time_changed: `Start time changed from ${previous || "not selected"} to ${next}`,
    addon_changed: `${addon} changed from ${previous} to ${next}`,
    addon_variant_changed: `${addon} size ${eventValue(details.variant)} changed from ${previous} to ${next}`,
    contact_field_completed: `${eventValue(details.field).replaceAll("_", " ")} completed`,
    contact_information_valid: "Contact information completed",
    add_to_cart: `Added ${product} to cart`,
    cart_opened: "Cart opened",
    cart_item_removed: `Removed ${product} from cart`,
    cart_item_edit_started: `Started editing ${product}`,
    cart_item_updated: `Updated ${product}`,
    discount_applied: `Applied discount code ${eventValue(details.code)}`,
    checkout_opened: "Secure checkout opened",
    checkout_reopened: "Checkout reopened",
    payment_element_ready: "Payment form ready",
    payment_attempted: "Payment attempted",
    payment_authentication_required: "Payment authentication required",
    payment_processing: "Payment processing",
    payment_succeeded: "Payment succeeded",
    payment_failed: eventValue(details.message) || "Payment failed",
    payment_cancelled: eventValue(details.message) || "Payment cancelled",
    checkout_expired: "Checkout expired",
    async_payment_failed: eventValue(details.message) || "Delayed payment failed",
    payment_error: eventValue(details.message) || "Payment error",
    payment_authentication_cancelled: "Payment authentication cancelled",
    checkout_page_hidden: "Checkout left or moved to the background",
    checkout_page_resumed: "Checkout resumed",
    recovery_email_opened: "Recovery email link opened",
    recovery_email_sent: "Recovery email sent",
  };
  return descriptions[event.type]
    || eventValue(details.message)
    || event.type.replaceAll("_", " ");
};

const sourceColor = (source: string): string => {
  if (source === "stripe") return "indigo";
  if (source === "server") return "gray";
  return "blue";
};

const eventColor = (severity: string): string => {
  if (severity === "error") return "red";
  if (severity === "warning") return "yellow";
  return "teal";
};

export const StorefrontActivityTimeline = ({
  visits,
  emptyMessage = "No storefront activity was recorded for this booking.",
}: StorefrontActivityTimelineProps) => {
  if (!visits.length) {
    return (
      <Box py={48} ta="center">
        <ThemeIcon size={44} radius="sm" variant="light" color="gray" mx="auto">
          <IconDeviceDesktopAnalytics size={24} />
        </ThemeIcon>
        <Text fw={700} mt="md">No activity available</Text>
        <Text size="sm" c="dimmed" maw={420} mx="auto" mt={4}>{emptyMessage}</Text>
      </Box>
    );
  }

  return (
    <Stack gap="md">
      {visits.map((visit, visitIndex) => {
        const sameBrowser = visitIndex > 0
          && visit.browserInstanceId
          && visit.browserInstanceId === visits[visitIndex - 1]?.browserInstanceId;
        return (
          <Paper key={visit.id} withBorder radius="sm" p={{ base: "sm", sm: "md" }}>
            <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="md">
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon size={36} radius="sm" variant="light" color={sameBrowser ? "teal" : "blue"}>
                  <IconBrowser size={20} />
                </ThemeIcon>
                <Box>
                  <Text fw={800}>Visit {visitIndex + 1}</Text>
                  <Text size="xs" c="dimmed">
                    {sameBrowser ? "Returned from the same browser" : "Storefront visit"}
                  </Text>
                </Box>
              </Group>
              <Group gap="xs">
                {visit.claritySampled && <Badge size="sm" variant="light" color="teal">Replay available</Badge>}
                <Badge size="sm" variant="outline" color="gray" leftSection={<IconClock size={12} />}>
                  {dayjs(visit.startedAt).format("D MMM YYYY, HH:mm:ss")}
                </Badge>
              </Group>
            </Group>

            <Box ml={17} pl="lg" style={{ borderLeft: "2px solid var(--mantine-color-gray-3)" }}>
              {visit.events.map((event, eventIndex) => (
                <Box
                  key={event.id}
                  pos="relative"
                  pb={eventIndex < visit.events.length - 1 ? "md" : 0}
                >
                  <Box
                    pos="absolute"
                    top={6}
                    left={-29}
                    w={10}
                    h={10}
                    bg={`var(--mantine-color-${eventColor(event.severity)}-6)`}
                    style={{ borderRadius: "50%", boxShadow: "0 0 0 4px var(--mantine-color-body)" }}
                  />
                  <Group justify="space-between" align="flex-start" wrap="wrap" gap={6}>
                    <Text size="sm" fw={650} style={{ flex: "1 1 260px" }}>
                      {storefrontJourneyEventDescription(event)}
                    </Text>
                    <Group gap={6}>
                      <Badge size="xs" variant="light" color={sourceColor(event.source)}>
                        {event.source}
                      </Badge>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {dayjs(event.occurredAt).format("HH:mm:ss")}
                      </Text>
                    </Group>
                  </Group>
                </Box>
              ))}
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
};
