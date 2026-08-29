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

const detailRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const itemNumber = (details: Record<string, unknown>): string => {
  const number = Number(details.cartItemNumber || details.cartPosition);
  return Number.isInteger(number) && number > 0 ? String(number).padStart(2, "0") : "";
};

const participantSummary = (snapshot: Record<string, unknown>): string => {
  const participants = detailRecord(snapshot.participants);
  if (participants) {
    const men = Number(participants.men) || 0;
    const women = Number(participants.women) || 0;
    const values = [
      men > 0 ? `${men} ${men === 1 ? "man" : "men"}` : "",
      women > 0 ? `${women} ${women === 1 ? "woman" : "women"}` : "",
    ].filter(Boolean);
    if (values.length) return values.join(" | ");
  }
  const quantity = Number(snapshot.quantity) || 0;
  return quantity > 0 ? `${quantity} ${quantity === 1 ? "guest" : "guests"}` : "";
};

const addonSummary = (snapshot: Record<string, unknown>): string => {
  if (!Array.isArray(snapshot.addons)) return "";
  return snapshot.addons.flatMap((candidate) => {
    const addon = detailRecord(candidate);
    if (!addon) return [];
    const name = eventValue(addon.name || "Add-on");
    if (Array.isArray(addon.variants) && addon.variants.length) {
      const variants = addon.variants.flatMap((candidateVariant) => {
        const variant = detailRecord(candidateVariant);
        if (!variant || Number(variant.quantity) <= 0) return [];
        return [`${eventValue(variant.value)} x ${Number(variant.quantity)}`];
      });
      if (variants.length) return [`${name}: ${variants.join(", ")}`];
    }
    if (addon.value !== null && addon.value !== undefined && addon.value !== "") {
      return [`${name}: ${eventValue(addon.value)}`];
    }
    const quantity = Number(addon.quantity) || 0;
    return quantity > 0 ? [`${name} x ${quantity}`] : [];
  }).join(" | ");
};

const totalSummary = (snapshot: Record<string, unknown>): string => {
  if (snapshot.itemTotal === null || snapshot.itemTotal === undefined || snapshot.itemTotal === "") {
    return "";
  }
  const total = Number(snapshot.itemTotal);
  if (!Number.isFinite(total)) return "";
  const currency = eventValue(snapshot.currency || "PLN");
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(total);
  } catch {
    return `${currency} ${total.toFixed(2)}`;
  }
};

const cartItemSummary = (snapshot: Record<string, unknown> | null): string => {
  if (!snapshot) return "";
  const date = eventValue(snapshot.experienceDate);
  const formattedDate = date && dayjs(date).isValid() ? dayjs(date).format("D MMM YYYY") : date;
  return [
    formattedDate,
    eventValue(snapshot.experienceTime),
    participantSummary(snapshot),
    addonSummary(snapshot),
    totalSummary(snapshot),
  ].filter(Boolean).join(" | ");
};

export const storefrontJourneyEventSummary = (event: StorefrontJourneyEvent): string => {
  const details = event.details || {};
  if (event.type === "cart_item_updated") {
    const previous = cartItemSummary(detailRecord(details.previousItem));
    const next = cartItemSummary(detailRecord(details.newItem) || details);
    if (!previous) return next;
    if (!next || previous === next) return `Selection: ${previous}`;
    return `Before: ${previous} | After: ${next}`;
  }
  if (!["add_to_cart", "cart_item_removed", "cart_item_edit_started"].includes(event.type)) {
    return "";
  }
  return cartItemSummary(details);
};

export const storefrontJourneyEventDescription = (event: StorefrontJourneyEvent): string => {
  const details = event.details || {};
  const product = eventValue(details.productName || details.productSlug || "experience");
  const previous = eventValue(details.previousValue);
  const next = eventValue(details.newValue);
  const participant = eventValue(details.participantType).replace("participants", "guests");
  const addon = eventValue(details.addonName || "Add-on");
  const number = itemNumber(details);
  const numberedProduct = number ? `item ${number}: ${product}` : product;
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
    add_to_cart: number ? `Added ${numberedProduct}` : `Added ${product} to cart`,
    cart_opened: "Cart opened",
    cart_item_removed: number ? `Removed ${numberedProduct}` : `Removed ${product} from cart`,
    cart_item_edit_started: `Started editing ${numberedProduct}`,
    cart_item_updated: `Updated ${numberedProduct}`,
    discount_applied: `Applied discount code ${eventValue(details.code)}`,
    checkout_opened: "Secure checkout opened",
    checkout_reopened: "Checkout reopened",
    payment_element_ready: "Payment form ready",
    payment_details_completed: "Payment details completed",
    payment_attempted: "Payment attempted",
    payment_authentication_required: "Payment authentication required",
    payment_processing: "Payment processing",
    payment_succeeded: "Payment succeeded",
    booking_confirmed: "Booking confirmed",
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
              {visit.events.map((event, eventIndex) => {
                const summary = storefrontJourneyEventSummary(event);
                return (
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
                    {summary && <Text size="xs" c="dimmed" mt={4}>{summary}</Text>}
                  </Box>
                );
              })}
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
};
