import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconActivity,
  IconCalendarEvent,
  IconClock,
  IconCreditCard,
  IconMail,
  IconReceipt,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";

import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";
import axiosInstance from "../../utils/axiosInstance";
import {
  formatStorefrontSaleDuration,
  getStorefrontSaleTiming,
} from "../../utils/storefrontSaleTiming";
import {
  StorefrontActivityTimeline,
  type StorefrontJourneyVisit,
} from "../storefront/StorefrontActivityTimeline";

export type BookingDetailsEmail = {
  id: number;
  messageId: string;
  threadId?: string | null;
  fromAddress?: string | null;
  toAddresses?: string | null;
  ccAddresses?: string | null;
  subject?: string | null;
  snippet?: string | null;
  receivedAt?: string | null;
  internalDate?: string | null;
  ingestionStatus?: string | null;
  failureReason?: string | null;
};

export type BookingDetailsEvent = {
  id: number;
  eventType?: string | null;
  statusAfter?: string | null;
  emailMessageId?: string | null;
  occurredAt?: string | null;
  ingestedAt?: string | null;
  processedAt?: string | null;
  processingError?: string | null;
  eventPayload?: Record<string, unknown> | null;
};

export type BookingEmailPreview = BookingDetailsEmail & {
  previewText: string | null;
  textBody: string | null;
  htmlBody: string | null;
  htmlText: string | null;
  gmailQuery?: string | null;
};

export type BookingDetailsBooking = {
  id: number;
  platform: string;
  platformBookingId?: string | null;
  platformOrderId?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  experienceDate?: string | null;
  experienceStartAt?: string | null;
  productName?: string | null;
  partySizeTotal?: number | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  lastEmailMessageId?: string | null;
  product?: {
    id: number;
    name: string;
    productTypeId?: number | null;
  } | null;
  guest?: {
    id: number;
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
  } | null;
  date?: string | null;
  timeslot?: string | null;
  customerName?: string | null;
  quantity?: number | null;
};

export type BookingStorefrontActivity = {
  order: {
    publicId: string;
    status: string;
    paymentStatus: string;
    paidAt: string | null;
  } | null;
  cart: {
    publicId: string;
    status: string;
    total: number;
    currency: string;
    openedAt: string | null;
    checkoutStartedAt: string | null;
    recoverySentAt: string | null;
    recoveryOpenedAt: string | null;
    recoveredAt: string | null;
    convertedAt: string | null;
  } | null;
  visits: StorefrontJourneyVisit[];
};

export type BookingDetailsResponse = {
  booking: BookingDetailsBooking;
  events: BookingDetailsEvent[];
  emails: BookingDetailsEmail[];
  stripe: {
    id: string;
    type: string;
    amount: number;
    amountRefunded: number;
    currency: string;
    status: string | null;
    created: number;
    receiptEmail?: string | null;
    description?: string | null;
    fullyRefunded: boolean;
  } | null;
  stripeError?: string | null;
  ecwidOrderId?: string | null;
  storeActivity: BookingStorefrontActivity | null;
};

type BookingDetailsState = {
  loading: boolean;
  error: string | null;
  data: BookingDetailsResponse | null;
  activeTab: string;
  previewMessageId: string | null;
  previewLoading: boolean;
  previewError: string | null;
  reprocessMessageId: string | null;
  reprocessError: string | null;
  previewData: BookingEmailPreview | null;
  previewOpen: boolean;
};

export type BookingDetailsModalProps = {
  opened: boolean;
  bookingId: number | null;
  onClose: () => void;
  onReprocessed?: () => void;
};

const PLATFORM_LABELS: Record<string, string> = {
  ecwid: "Ecwid",
  fareharbor: "FareHarbor",
  viator: "Viator",
  getyourguide: "GetYourGuide",
  freetour: "FreeTour",
  xperiencepoland: "XperiencePoland",
  direct: "Direct",
  airbnb: "Airbnb",
  unknown: "Unknown",
};

const createDefaultDetailsState = (): BookingDetailsState => ({
  loading: false,
  error: null,
  data: null,
  activeTab: "emails",
  previewMessageId: null,
  previewLoading: false,
  previewError: null,
  reprocessMessageId: null,
  reprocessError: null,
  previewData: null,
  previewOpen: false,
});

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const getBookingIdFromOrder = (order: UnifiedOrder): number | null => {
  const rawData = order?.rawData;
  const rawBookingId = rawData && typeof rawData === "object"
    ? (rawData as { bookingId?: unknown }).bookingId
    : null;
  return parsePositiveInteger(rawBookingId) ?? parsePositiveInteger(order?.id);
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : String(value);
};

const formatSaleTime = (value: string): string => dayjs(value).format("HH:mm:ss");

const formatBookingActivityDate = (booking: BookingDetailsBooking): string => {
  const value = booking.experienceDate ?? booking.date;
  if (!value) return "Date not recorded";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMM YYYY") : value;
};

const formatBookingActivityTime = (booking: BookingDetailsBooking): string => {
  if (booking.experienceStartAt) {
    const parsed = dayjs(booking.experienceStartAt);
    if (parsed.isValid()) return parsed.format("HH:mm");
  }
  return booking.timeslot?.trim() || "Time not recorded";
};

const getBookingDetailsCustomerName = (booking: BookingDetailsBooking): string => {
  const directName = [booking.guestFirstName, booking.guestLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return directName || booking.guest?.name?.trim() || booking.customerName?.trim() || "Guest not recorded";
};

const getBookingDetailsProductName = (booking: BookingDetailsBooking): string => (
  booking.productName?.trim() || booking.product?.name?.trim() || "Experience"
);

const getBookingDetailsReference = (booking: BookingDetailsBooking): string => (
  booking.platformBookingId?.trim()
  || booking.platformOrderId?.trim()
  || String(booking.id)
);

const getBookingDetailsStatusColor = (status?: string | null): string => {
  const normalized = String(status ?? "").toLowerCase();
  if (["confirmed", "completed", "succeeded", "paid", "converted"].includes(normalized)) return "green";
  if (["cancelled", "canceled", "failed", "refunded"].includes(normalized)) return "red";
  if (["pending", "processing", "checkout_started"].includes(normalized)) return "yellow";
  return "gray";
};

const formatPlatformLabel = (value?: string | null): string => {
  const key = String(value ?? "").trim().toLowerCase();
  if (key && PLATFORM_LABELS[key]) return PLATFORM_LABELS[key];
  return String(value ?? "Unknown")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
};

const formatStorefrontMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "PLN",
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${String(currency || "PLN").toUpperCase()}`;
  }
};

const getStripeStatusColor = (status?: string | null): string => {
  switch (status) {
    case "succeeded": return "green";
    case "pending": return "yellow";
    case "failed": return "red";
    case "canceled": return "gray";
    default: return "blue";
  }
};

const formatStripeAmount = (amount: number, currency: string): string => (
  `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
);

const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Something went wrong";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const responseData = "response" in error
      ? (error as { response?: { data?: unknown } }).response?.data
      : null;
    if (typeof responseData === "string") return responseData;
    if (responseData && typeof responseData === "object" && "message" in responseData) {
      const nestedMessage = (responseData as { message?: unknown }).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;
    }
    if ("message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return "Something went wrong";
};

const BookingDetailsModal = ({
  opened,
  bookingId,
  onClose,
  onReprocessed,
}: BookingDetailsModalProps) => {
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [detailsState, setDetailsState] = useState<BookingDetailsState>(createDefaultDetailsState);
  const activeBookingIdRef = useRef<number | null>(opened ? bookingId : null);
  const previewRequestRef = useRef(0);
  const reprocessRequestRef = useRef(0);
  activeBookingIdRef.current = opened ? bookingId : null;

  useEffect(() => {
    let active = true;
    previewRequestRef.current += 1;
    reprocessRequestRef.current += 1;
    if (!opened) {
      setDetailsState(createDefaultDetailsState());
      return () => {
        active = false;
        previewRequestRef.current += 1;
        reprocessRequestRef.current += 1;
      };
    }
    if (!bookingId) {
      setDetailsState({
        ...createDefaultDetailsState(),
        error: "Unable to locate OmniLodge booking reference for this order.",
      });
      return () => {
        active = false;
        previewRequestRef.current += 1;
        reprocessRequestRef.current += 1;
      };
    }

    setDetailsState({ ...createDefaultDetailsState(), loading: true });
    void axiosInstance
      .get<BookingDetailsResponse>(`/bookings/${bookingId}/details`)
      .then((response) => {
        if (!active) return;
        setDetailsState((current) => ({
          ...current,
          loading: false,
          data: response.data,
          error: null,
          activeTab: response.data.storeActivity?.visits.length ? "store-activity" : "emails",
        }));
      })
      .catch((error) => {
        if (!active) return;
        setDetailsState((current) => ({
          ...current,
          loading: false,
          error: extractErrorMessage(error),
        }));
      });

    return () => {
      active = false;
      previewRequestRef.current += 1;
      reprocessRequestRef.current += 1;
    };
  }, [bookingId, opened]);

  const handleClose = () => {
    activeBookingIdRef.current = null;
    previewRequestRef.current += 1;
    reprocessRequestRef.current += 1;
    setDetailsState(createDefaultDetailsState());
    onClose();
  };

  const handleDetailsPreview = async (messageId: string) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const requestedBookingId = bookingId;
    setDetailsState((current) => ({
      ...current,
      previewMessageId: messageId,
      previewLoading: true,
      previewError: null,
      previewData: null,
      previewOpen: true,
    }));
    try {
      const response = await axiosInstance.get(`/bookings/emails/${encodeURIComponent(messageId)}/preview`);
      if (
        previewRequestRef.current !== requestId
        || activeBookingIdRef.current !== requestedBookingId
      ) {
        return;
      }
      setDetailsState((current) => ({
        ...current,
        previewLoading: false,
        previewData: response.data as BookingEmailPreview,
        previewError: null,
      }));
    } catch (error) {
      if (
        previewRequestRef.current !== requestId
        || activeBookingIdRef.current !== requestedBookingId
      ) {
        return;
      }
      setDetailsState((current) => ({
        ...current,
        previewLoading: false,
        previewError: extractErrorMessage(error),
      }));
    }
  };

  const handleDetailsReprocess = async (messageId: string) => {
    if (!messageId || detailsState.reprocessMessageId) return;
    const requestId = reprocessRequestRef.current + 1;
    reprocessRequestRef.current = requestId;
    const requestedBookingId = bookingId;
    setDetailsState((current) => ({
      ...current,
      reprocessMessageId: messageId,
      reprocessError: null,
    }));
    try {
      await axiosInstance.post(
        `/bookings/emails/${encodeURIComponent(messageId)}/reprocess`,
        {},
        { withCredentials: true },
      );
      onReprocessed?.();
      if (
        reprocessRequestRef.current !== requestId
        || activeBookingIdRef.current !== requestedBookingId
      ) {
        return;
      }
      if (requestedBookingId) {
        const response = await axiosInstance.get<BookingDetailsResponse>(`/bookings/${requestedBookingId}/details`);
        if (
          reprocessRequestRef.current !== requestId
          || activeBookingIdRef.current !== requestedBookingId
        ) {
          return;
        }
        setDetailsState((current) => ({ ...current, data: response.data, error: null }));
      }
    } catch (error) {
      if (
        reprocessRequestRef.current !== requestId
        || activeBookingIdRef.current !== requestedBookingId
      ) {
        return;
      }
      setDetailsState((current) => ({
        ...current,
        reprocessError: extractErrorMessage(error),
      }));
    } finally {
      if (
        reprocessRequestRef.current === requestId
        && activeBookingIdRef.current === requestedBookingId
      ) {
        setDetailsState((current) => ({ ...current, reprocessMessageId: null }));
      }
    }
  };

  const closeDetailsPreview = () => {
    previewRequestRef.current += 1;
    setDetailsState((current) => ({
      ...current,
      previewOpen: false,
      previewLoading: false,
      previewError: null,
      previewData: null,
      previewMessageId: null,
    }));
  };

  const detailsPreviewHtml = detailsState.previewData?.htmlBody ?? null;
  const detailsPreviewBody = detailsState.previewData?.previewText
    ?? detailsState.previewData?.textBody
    ?? detailsState.previewData?.htmlText
    ?? detailsState.previewData?.snippet
    ?? null;
  const storefrontSaleTiming = getStorefrontSaleTiming(detailsState.data?.storeActivity?.visits);
  const storefrontActivityCart = detailsState.data?.storeActivity?.cart;
  const storefrontCartTimingEntries: Array<{ label: string; value: string | null }> = storefrontActivityCart
    ? [
      { label: "Cart opened", value: storefrontActivityCart.openedAt ? formatDateTime(storefrontActivityCart.openedAt) : null },
      { label: "Sale Started", value: storefrontSaleTiming ? formatSaleTime(storefrontSaleTiming.startedAt) : null },
      { label: "Sale Finished", value: storefrontSaleTiming ? formatSaleTime(storefrontSaleTiming.finishedAt) : null },
      {
        label: "Duration",
        value: storefrontSaleTiming ? formatStorefrontSaleDuration(storefrontSaleTiming.durationSeconds) : null,
      },
      { label: "Recovery sent", value: storefrontActivityCart.recoverySentAt ? formatDateTime(storefrontActivityCart.recoverySentAt) : null },
      { label: "Recovery opened", value: storefrontActivityCart.recoveryOpenedAt ? formatDateTime(storefrontActivityCart.recoveryOpenedAt) : null },
      { label: "Recovered", value: storefrontActivityCart.recoveredAt ? formatDateTime(storefrontActivityCart.recoveredAt) : null },
    ]
    : [];

  return (
    <>
      <Modal
        opened={opened}
        onClose={handleClose}
        title={(
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="blue" radius="sm" size={38}>
              <IconReceipt size={21} />
            </ThemeIcon>
            <Box>
              <Text fw={800} size="lg" lh={1.2}>Booking details</Text>
              <Text size="xs" c="dimmed">Reservation overview and history</Text>
            </Box>
          </Group>
        )}
        size="xl"
        fullScreen={Boolean(isMobile)}
        centered={!isMobile}
        styles={{
          content: { overflowY: "auto" },
          body: { padding: 0 },
          header: {
            borderBottom: "1px solid var(--mantine-color-gray-2)",
            position: "sticky",
            top: 0,
            zIndex: 3,
          },
        }}
      >
        <Box mih={360}>
          {detailsState.loading && (
            <Stack align="center" justify="center" gap="sm" mih={360}>
              <Loader size="md" />
              <Text size="sm" c="dimmed">Loading booking details...</Text>
            </Stack>
          )}
          {detailsState.error && (
            <Box p={{ base: "md", sm: "xl" }}>
              <Alert color="red" title="Unable to load booking details">
                {detailsState.error}
              </Alert>
            </Box>
          )}
          {!detailsState.loading && !detailsState.error && detailsState.data && (
            <>
              <Box
                px={{ base: "md", sm: "xl" }}
                py={{ base: "md", sm: "lg" }}
                bg="gray.0"
                style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}
              >
                <Group justify="space-between" align="flex-start" gap="md" wrap="wrap" mb="lg">
                  <Box style={{ minWidth: 0 }}>
                    <Text size="xs" tt="uppercase" fw={800} c="dimmed">Experience</Text>
                    <Title order={3} mt={3} style={{ wordBreak: "break-word" }}>
                      {getBookingDetailsProductName(detailsState.data.booking)}
                    </Title>
                  </Box>
                  <Group gap="xs">
                    <Badge
                      variant="light"
                      color={getBookingDetailsStatusColor(detailsState.data.booking.status)}
                      size="lg"
                    >
                      {String(detailsState.data.booking.status || "Unknown").replaceAll("_", " ")}
                    </Badge>
                    {detailsState.data.booking.paymentStatus && (
                      <Badge
                        variant="outline"
                        color={getBookingDetailsStatusColor(detailsState.data.booking.paymentStatus)}
                        size="lg"
                      >
                        {detailsState.data.booking.paymentStatus.replaceAll("_", " ")}
                      </Badge>
                    )}
                  </Group>
                </Group>

                <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <ThemeIcon variant="light" color="blue" radius="sm"><IconUser size={17} /></ThemeIcon>
                    <Box style={{ minWidth: 0 }}>
                      <Text size="xs" c="dimmed" fw={700}>CUSTOMER</Text>
                      <Text size="sm" fw={700} style={{ wordBreak: "break-word" }}>
                        {getBookingDetailsCustomerName(detailsState.data.booking)}
                      </Text>
                      <Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
                        {detailsState.data.booking.guestEmail ?? detailsState.data.booking.guest?.email ?? "No email"}
                      </Text>
                      {(detailsState.data.booking.guestPhone ?? detailsState.data.booking.guest?.phoneNumber) && (
                        <Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
                          {detailsState.data.booking.guestPhone ?? detailsState.data.booking.guest?.phoneNumber}
                        </Text>
                      )}
                    </Box>
                  </Group>
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <ThemeIcon variant="light" color="teal" radius="sm"><IconCalendarEvent size={17} /></ThemeIcon>
                    <Box>
                      <Text size="xs" c="dimmed" fw={700}>ACTIVITY</Text>
                      <Text size="sm" fw={700}>{formatBookingActivityDate(detailsState.data.booking)}</Text>
                      <Text size="xs" c="dimmed">{formatBookingActivityTime(detailsState.data.booking)}</Text>
                    </Box>
                  </Group>
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <ThemeIcon variant="light" color="grape" radius="sm"><IconUsers size={17} /></ThemeIcon>
                    <Box>
                      <Text size="xs" c="dimmed" fw={700}>GUESTS</Text>
                      <Text size="sm" fw={700}>
                        {detailsState.data.booking.partySizeTotal ?? detailsState.data.booking.quantity ?? "-"}
                      </Text>
                      <Text size="xs" c="dimmed">people booked</Text>
                    </Box>
                  </Group>
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <ThemeIcon variant="light" color="orange" radius="sm"><IconReceipt size={17} /></ThemeIcon>
                    <Box style={{ minWidth: 0 }}>
                      <Text size="xs" c="dimmed" fw={700}>REFERENCE</Text>
                      <Text size="sm" fw={700} style={{ wordBreak: "break-all" }}>
                        {getBookingDetailsReference(detailsState.data.booking)}
                      </Text>
                      <Text size="xs" c="dimmed">{formatPlatformLabel(detailsState.data.booking.platform)}</Text>
                    </Box>
                  </Group>
                </SimpleGrid>
              </Box>

              <Tabs
                value={detailsState.activeTab}
                onChange={(value) => setDetailsState((current) => ({ ...current, activeTab: value ?? "emails" }))}
              >
                <Tabs.List px={{ base: "sm", sm: "xl" }} style={{ overflowX: "auto", flexWrap: "nowrap" }}>
                  <Tabs.Tab value="emails" leftSection={<IconMail size={16} />} style={{ flexShrink: 0 }}>
                    Emails ({detailsState.data.emails.length})
                  </Tabs.Tab>
                  <Tabs.Tab value="events" leftSection={<IconActivity size={16} />} style={{ flexShrink: 0 }}>
                    Booking events ({detailsState.data.events.length})
                  </Tabs.Tab>
                  <Tabs.Tab value="stripe" leftSection={<IconCreditCard size={16} />} style={{ flexShrink: 0 }}>
                    Payment
                  </Tabs.Tab>
                  {detailsState.data.storeActivity && (
                    <Tabs.Tab value="store-activity" leftSection={<IconClock size={16} />} style={{ flexShrink: 0 }}>
                      Store activity ({detailsState.data.storeActivity.visits.length})
                    </Tabs.Tab>
                  )}
                </Tabs.List>

                <Tabs.Panel value="emails" p={{ base: "md", sm: "xl" }}>
                  {detailsState.data.emails.length === 0 ? (
                    <Box py={48} ta="center">
                      <ThemeIcon size={44} radius="sm" variant="light" color="gray" mx="auto">
                        <IconMail size={24} />
                      </ThemeIcon>
                      <Text fw={700} mt="md">No related emails</Text>
                      <Text size="sm" c="dimmed" mt={4}>No email messages were linked to this booking.</Text>
                    </Box>
                  ) : (
                    <Stack gap="sm">
                      {isMobile ? detailsState.data.emails.map((email) => {
                        const reprocessLoading = detailsState.reprocessMessageId === email.messageId;
                        const reprocessDisabled = detailsState.reprocessMessageId !== null && !reprocessLoading;
                        return (
                          <Paper key={email.messageId} withBorder radius="sm" p="md">
                            <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
                              <Box style={{ minWidth: 0 }}>
                                <Text fw={700} size="sm" style={{ wordBreak: "break-word" }}>
                                  {email.subject ?? email.messageId}
                                </Text>
                                <Text size="xs" c="dimmed" mt={4}>
                                  {formatDateTime(email.receivedAt ?? email.internalDate ?? null)}
                                </Text>
                              </Box>
                              <Badge variant="light" color={email.ingestionStatus === "processed" ? "green" : "gray"}>
                                {email.ingestionStatus ?? "Unknown"}
                              </Badge>
                            </Group>
                            <Group grow mt="md">
                              <Button size="xs" variant="light" onClick={() => handleDetailsPreview(email.messageId)}>
                                Preview
                              </Button>
                              <Button
                                size="xs"
                                color="orange"
                                variant="light"
                                loading={reprocessLoading}
                                disabled={reprocessDisabled}
                                onClick={() => handleDetailsReprocess(email.messageId)}
                              >
                                Reprocess
                              </Button>
                            </Group>
                          </Paper>
                        );
                      }) : (
                        <Table.ScrollContainer minWidth={760}>
                          <Table striped highlightOnHover verticalSpacing="sm">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Subject</Table.Th>
                                <Table.Th>Received</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Actions</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {detailsState.data.emails.map((email) => {
                                const reprocessLoading = detailsState.reprocessMessageId === email.messageId;
                                const reprocessDisabled = detailsState.reprocessMessageId !== null && !reprocessLoading;
                                return (
                                  <Table.Tr key={email.messageId}>
                                    <Table.Td><Text size="sm" fw={600}>{email.subject ?? email.messageId}</Text></Table.Td>
                                    <Table.Td>{formatDateTime(email.receivedAt ?? email.internalDate ?? null)}</Table.Td>
                                    <Table.Td>
                                      <Badge variant="light" color={email.ingestionStatus === "processed" ? "green" : "gray"}>
                                        {email.ingestionStatus ?? "Unknown"}
                                      </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                      <Group gap="xs">
                                        <Button size="xs" variant="light" onClick={() => handleDetailsPreview(email.messageId)}>
                                          Preview
                                        </Button>
                                        <Button
                                          size="xs"
                                          color="orange"
                                          variant="light"
                                          loading={reprocessLoading}
                                          disabled={reprocessDisabled}
                                          onClick={() => handleDetailsReprocess(email.messageId)}
                                        >
                                          Reprocess
                                        </Button>
                                      </Group>
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </Table>
                        </Table.ScrollContainer>
                      )}
                      {detailsState.reprocessError && (
                        <Alert color="red" title="Unable to reprocess email">{detailsState.reprocessError}</Alert>
                      )}
                      {detailsState.previewError && (
                        <Alert color="red" title="Unable to load email preview">{detailsState.previewError}</Alert>
                      )}
                    </Stack>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="events" p={{ base: "md", sm: "xl" }}>
                  {detailsState.data.events.length === 0 ? (
                    <Box py={48} ta="center">
                      <ThemeIcon size={44} radius="sm" variant="light" color="gray" mx="auto">
                        <IconActivity size={24} />
                      </ThemeIcon>
                      <Text fw={700} mt="md">No booking events</Text>
                      <Text size="sm" c="dimmed" mt={4}>No system events were recorded for this booking.</Text>
                    </Box>
                  ) : isMobile ? (
                    <Stack gap="sm">
                      {detailsState.data.events.map((event) => (
                        <Paper key={event.id} withBorder radius="sm" p="md">
                          <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
                            <Box style={{ minWidth: 0 }}>
                              <Text fw={700} size="sm" style={{ wordBreak: "break-word" }}>
                                {event.eventType?.replaceAll("_", " ") ?? "Unknown event"}
                              </Text>
                              <Text size="xs" c="dimmed" mt={4}>{formatDateTime(event.occurredAt ?? null)}</Text>
                            </Box>
                            <Badge variant="light" color={getBookingDetailsStatusColor(event.statusAfter)}>
                              {event.statusAfter?.replaceAll("_", " ") ?? "No status"}
                            </Badge>
                          </Group>
                          <Divider my="sm" />
                          <SimpleGrid cols={2} spacing="xs">
                            <Box>
                              <Text size="xs" c="dimmed">Processed</Text>
                              <Text size="xs" fw={600}>{formatDateTime(event.processedAt ?? null)}</Text>
                            </Box>
                            <Box>
                              <Text size="xs" c="dimmed">Message ID</Text>
                              <Text size="xs" fw={600} lineClamp={1}>{event.emailMessageId ?? "-"}</Text>
                            </Box>
                          </SimpleGrid>
                        </Paper>
                      ))}
                    </Stack>
                  ) : (
                    <Table.ScrollContainer minWidth={820}>
                      <Table striped highlightOnHover verticalSpacing="sm">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Type</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Occurred</Table.Th>
                            <Table.Th>Processed</Table.Th>
                            <Table.Th>Message ID</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {detailsState.data.events.map((event) => (
                            <Table.Tr key={event.id}>
                              <Table.Td><Text size="sm" fw={600}>{event.eventType?.replaceAll("_", " ") ?? "-"}</Text></Table.Td>
                              <Table.Td>
                                <Badge variant="light" color={getBookingDetailsStatusColor(event.statusAfter)}>
                                  {event.statusAfter?.replaceAll("_", " ") ?? "-"}
                                </Badge>
                              </Table.Td>
                              <Table.Td>{formatDateTime(event.occurredAt ?? null)}</Table.Td>
                              <Table.Td>{formatDateTime(event.processedAt ?? null)}</Table.Td>
                              <Table.Td><Text size="xs" ff="monospace">{event.emailMessageId ?? "-"}</Text></Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="stripe" p={{ base: "md", sm: "xl" }}>
                  {detailsState.data.stripe ? (
                    <Stack gap="lg">
                      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
                        <Box>
                          <Text size="xs" c="dimmed" fw={700}>TRANSACTION AMOUNT</Text>
                          <Text fz={28} fw={800} mt={2}>
                            {formatStripeAmount(detailsState.data.stripe.amount, detailsState.data.stripe.currency)}
                          </Text>
                        </Box>
                        <Badge size="lg" variant="light" color={getStripeStatusColor(detailsState.data.stripe.status)}>
                          {detailsState.data.stripe.status ?? "Unknown"}
                        </Badge>
                      </Group>
                      <Divider />
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
                        {[
                          ["Transaction", detailsState.data.stripe.id],
                          ["Type", detailsState.data.stripe.type],
                          ["Refunded", formatStripeAmount(detailsState.data.stripe.amountRefunded, detailsState.data.stripe.currency)],
                          ["Receipt email", detailsState.data.stripe.receiptEmail ?? "-"],
                          ["Created", detailsState.data.stripe.created ? formatDateTime(new Date(detailsState.data.stripe.created * 1000).toISOString()) : "-"],
                          ["Refund status", detailsState.data.stripe.fullyRefunded ? "Fully refunded" : "Not fully refunded"],
                        ].map(([label, value]) => (
                          <Box key={label}>
                            <Text size="xs" c="dimmed" fw={700}>{label.toUpperCase()}</Text>
                            <Text size="sm" fw={600} mt={4} style={{ wordBreak: "break-word" }}>{value}</Text>
                          </Box>
                        ))}
                      </SimpleGrid>
                    </Stack>
                  ) : (
                    <Box py={48} ta="center">
                      <ThemeIcon size={44} radius="sm" variant="light" color="gray" mx="auto">
                        <IconCreditCard size={24} />
                      </ThemeIcon>
                      <Text fw={700} mt="md">No payment data</Text>
                      <Text size="sm" c="dimmed" maw={420} mx="auto" mt={4}>
                        {detailsState.data.stripeError ?? "No Stripe transaction was found for this booking."}
                      </Text>
                    </Box>
                  )}
                </Tabs.Panel>

                {detailsState.data.storeActivity && (
                  <Tabs.Panel value="store-activity" p={{ base: "md", sm: "xl" }}>
                    <Stack gap="lg">
                      {detailsState.data.storeActivity.order && (
                        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
                          <Box style={{ minWidth: 0 }}>
                            <Text size="xs" c="dimmed" fw={700}>STOREFRONT ORDER</Text>
                            <Text size="sm" fw={700} ff="monospace" mt={4} style={{ wordBreak: "break-all" }}>
                              {detailsState.data.storeActivity.order.publicId}
                            </Text>
                            <Text size="xs" c="dimmed" mt={4}>
                              Paid {formatDateTime(detailsState.data.storeActivity.order.paidAt)}
                            </Text>
                          </Box>
                          <Group gap="xs">
                            <Badge
                              size="lg"
                              variant="light"
                              color={getBookingDetailsStatusColor(detailsState.data.storeActivity.order.status)}
                            >
                              {detailsState.data.storeActivity.order.status.replaceAll("_", " ")}
                            </Badge>
                            <Badge
                              size="lg"
                              variant="outline"
                              color={getBookingDetailsStatusColor(detailsState.data.storeActivity.order.paymentStatus)}
                            >
                              {detailsState.data.storeActivity.order.paymentStatus.replaceAll("_", " ")}
                            </Badge>
                          </Group>
                        </Group>
                      )}
                      {detailsState.data.storeActivity.cart && (
                        <Box
                          p={{ base: "md", sm: "lg" }}
                          bg="gray.0"
                          style={{ border: "1px solid var(--mantine-color-gray-2)", borderRadius: 6 }}
                        >
                          <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
                            <Box>
                              <Text size="xs" c="dimmed" fw={700}>STOREFRONT CART</Text>
                              <Text size="sm" fw={700} ff="monospace" mt={4}>
                                {detailsState.data.storeActivity.cart.publicId}
                              </Text>
                            </Box>
                            <Group gap="xs">
                              <Badge
                                size="lg"
                                variant="light"
                                color={getBookingDetailsStatusColor(detailsState.data.storeActivity.cart.status)}
                              >
                                {detailsState.data.storeActivity.cart.status.replaceAll("_", " ")}
                              </Badge>
                              <Badge size="lg" variant="outline" color="gray">
                                {formatStorefrontMoney(
                                  detailsState.data.storeActivity.cart.total,
                                  detailsState.data.storeActivity.cart.currency,
                                )}
                              </Badge>
                            </Group>
                          </Group>
                          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md" mt="lg">
                            {storefrontCartTimingEntries.filter(({ value }) => Boolean(value)).map(({ label, value }) => (
                              <Box key={label}>
                                <Text size="xs" c="dimmed">{label}</Text>
                                <Text size="sm" fw={600}>{value}</Text>
                              </Box>
                            ))}
                          </SimpleGrid>
                        </Box>
                      )}
                      <StorefrontActivityTimeline
                        visits={detailsState.data.storeActivity.visits}
                        emptyMessage={detailsState.data.storeActivity.cart
                          ? "This linked storefront cart does not have recorded journey events."
                          : "No storefront cart could be linked to this booking. Older bookings may predate journey tracking."}
                      />
                    </Stack>
                  </Tabs.Panel>
                )}
              </Tabs>
            </>
          )}
        </Box>
      </Modal>

      <Modal
        opened={detailsState.previewOpen}
        onClose={closeDetailsPreview}
        title="Email preview"
        fullScreen
        centered
      >
        <Stack gap="sm">
          {detailsState.previewError && (
            <Alert color="red" title="Failed to load email preview">{detailsState.previewError}</Alert>
          )}
          {detailsState.previewLoading && (
            <Box style={{ minHeight: 120 }}><Loader variant="dots" /></Box>
          )}
          {detailsState.previewData && (
            <>
              <Stack gap={4}>
                <Text fw={600}>{detailsState.previewData.subject ?? "No subject"}</Text>
                <Text size="sm" c="dimmed">{detailsState.previewData.fromAddress ?? "-"}</Text>
                <Text size="sm" c="dimmed">{detailsState.previewData.toAddresses ?? "-"}</Text>
                <Text size="sm">
                  {formatDateTime(detailsState.previewData.receivedAt ?? detailsState.previewData.internalDate ?? null)}
                </Text>
                <Badge size="sm" variant="light">
                  {(detailsState.previewData.ingestionStatus ?? "unknown").toUpperCase()}
                </Badge>
              </Stack>
              {detailsPreviewHtml ? (
                <Box style={{ height: "calc(100vh - 240px)" }}>
                  <iframe
                    title="Email HTML preview"
                    srcDoc={detailsPreviewHtml}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                    }}
                  />
                </Box>
              ) : detailsPreviewBody ? (
                <Paper withBorder radius="md" p="sm" bg="#f8fafc">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{detailsPreviewBody}</Text>
                </Paper>
              ) : (
                <Alert color="yellow" title="No preview content">No email preview content available.</Alert>
              )}
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
};

export default BookingDetailsModal;
