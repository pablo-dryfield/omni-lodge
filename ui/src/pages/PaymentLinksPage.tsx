import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBan,
  IconBuildingBank,
  IconCircleCheck,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconListDetails,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSend,
  IconShoppingCart,
  IconTrash,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";
import { useNavigate, useSearchParams } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import {
  storefrontJourneyEventDescription,
  storefrontJourneyEventSummary,
} from "../components/storefront/StorefrontActivityTimeline";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";

type AddonConfig = {
  selectionMode?: "boolean" | "quantity" | "range" | "options";
  allowedQuantities?: number[];
  minQuantity?: number;
  maxQuantity?: number;
  options?: Array<{ value: string; label: string; price?: number }>;
};

type StorefrontAddon = {
  id: number;
  name: string;
  price: { amount: number; currency: string } | null;
  maxPerAttendee: number | null;
  config: AddonConfig;
  inventory: {
    variantSelectionRequired: boolean;
    variants: Array<{ value: string; label: string; availableQuantity: number; inStock: boolean }>;
  };
};

type StorefrontProduct = {
  id: number;
  slug: string;
  name: string;
  price: { amount: number; currency: string };
  config: {
    participantMode?: "quantity" | "gender_split";
    minParticipants?: number;
    maxParticipants?: number;
    dateRequired?: boolean;
    timeMode?: "fixed" | "select" | "manual";
    defaultStartTime?: string;
    startTimes?: string[];
  };
  addons: StorefrontAddon[];
};

type AddonDraft = {
  enabled: boolean;
  quantity: number;
  value: string;
  variants: Record<string, number>;
};

type CartItemDraft = {
  key: string;
  productId: number | null;
  experienceDate: string;
  experienceTime: string;
  quantity: number;
  men: number;
  women: number;
  addons: Record<number, AddonDraft>;
};

type CartAddonInput = {
  addonId: number;
  quantity?: number;
  value?: string;
  variants?: Array<{ value: string; quantity: number }>;
};

type Quote = {
  currency: string;
  subtotal: number;
  addonTotal: number;
  discountTotal: number;
  total: number;
  items: Array<{ productName: string; total: number }>;
};

type SavedCart = {
  publicId: string;
  name: string;
  status: string;
  total: number;
  currency: string;
  expiresAt: string;
  openedAt: string | null;
  checkoutStartedAt: string | null;
  paidAt: string | null;
  orderPublicId: string | null;
  createdAt: string;
};

type OngoingCart = {
  publicId: string;
  status: string;
  customer: { fullName: string; email: string; phoneCountry: string; phone: string };
  quote: {
    items: Array<{
      productName: string;
      quantity: number;
      experienceDate: string | null;
      experienceTime: string | null;
      addons: Array<{
        name: string;
        quantity: number;
        value: string | null;
        variants: Array<{ value: string; quantity: number }>;
      }>;
      options: Record<string, unknown>;
    }>;
  };
  total: number;
  currency: string;
  lastActivityAt: string;
  recoveryDueAt: string;
  recoverySentAt: string | null;
  firstRecoverySentAt: string | null;
  lastRecoverySentAt: string | null;
  recoveryOpenedAt: string | null;
  recoveredAt: string | null;
  recoveryCount: number;
  createdAt: string;
  orderPublicId: string | null;
  events: Array<{
    id: string;
    type: string;
    severity: "info" | "warning" | "error";
    message: string;
    details: Record<string, unknown> | null;
    occurredAt: string;
  }>;
};

type BankTransferOrderActor = {
  id: number;
  fullName: string;
};

type BankTransferOrder = {
  publicId: string;
  status: "awaiting_transfer" | "payment_received" | "cancelled";
  paymentStatus: string;
  paymentReference: string | null;
  receivedPaymentReference: string | null;
  paymentDueAt: string | null;
  paymentNote: string | null;
  total: number;
  currency: string;
  customer: {
    fullName: string;
    email: string;
    phoneCountry: string | null;
    phone: string | null;
  };
  items: OngoingCart["quote"]["items"];
  createdBy: BankTransferOrderActor | null;
  receivedBy: BankTransferOrderActor | null;
  createdAt: string;
  paidAt: string | null;
  customerEmailSentAt: string | null;
  internalEmailSentAt: string | null;
  confirmationEmailComplete: boolean;
  bankTransferInstructionsEmailSentAt: string | null;
  bankTransferCancellationEmailSentAt: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
};

type RecoveryEmailPreview = {
  cart: OngoingCart;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
};

type JourneyEvent = {
  id: string;
  type: string;
  source: "client" | "server" | "stripe";
  severity: "info" | "warning" | "error";
  sequence: number | null;
  occurredAt: string;
  receivedAt: string;
  details: Record<string, unknown> | null;
};

type JourneyVisit = {
  id: string;
  browserInstanceId: string | null;
  startedAt: string;
  lastActivityAt: string;
  qualifiedAt: string;
  claritySampled: boolean;
  claritySessionId: string | null;
  events: JourneyEvent[];
};

type CartActivity = {
  publicId: string;
  visits: JourneyVisit[];
  legacyEvents: OngoingCart["events"];
};

type StorefrontCartTab = "prepared" | "bank-transfers" | "ongoing" | "recovered";
type CreatorMode = "payment-link" | "bank-transfer";
type BankTransferNotice = {
  color: "green" | "red" | "yellow";
  title: string;
  message: string;
};

const storefrontCartTabs = new Set<StorefrontCartTab>([
  "prepared",
  "bank-transfers",
  "ongoing",
  "recovered",
]);
const BANK_TRANSFER_BOOKINGS_MODULE = "bank-transfer-booking-management";

const storefrontCartTab = (value: string | null): StorefrontCartTab => (
  value && storefrontCartTabs.has(value as StorefrontCartTab)
    ? (value as StorefrontCartTab)
    : "prepared"
);

const storefrontBaseUrl = (process.env.REACT_APP_STOREFRONT_URL || "https://krawlthroughkrakow.com/store2")
  .replace(/\/+$/, "");
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryOptions = getCountries()
  .map((code) => ({
    value: code,
    label: `${regionNames.of(code) || code} (+${getCountryCallingCode(code)})`,
  }))
  .sort((left, right) => left.label.localeCompare(right.label));

const emptyItem = (): CartItemDraft => ({
  key: `${Date.now()}-${Math.random()}`,
  productId: null,
  experienceDate: "",
  experienceTime: "",
  quantity: 1,
  men: 1,
  women: 0,
  addons: {},
});

const statusColor = (status: string): string => ({
  active: "blue",
  opened: "cyan",
  checkout_started: "yellow",
  paid: "green",
  expired: "gray",
  disabled: "red",
  sending_recovery: "orange",
  recovery_sent: "pink",
  converted: "green",
  dismissed: "gray",
}[status] || "gray");

const statusLabel = (status: string): string => ({
  active: "Not opened",
  opened: "Opened",
  checkout_started: "Checkout started",
  paid: "Paid",
  expired: "Expired",
  disabled: "Disabled",
  sending_recovery: "Sending recovery",
  recovery_sent: "Recovery sent",
  converted: "Converted",
  dismissed: "Dismissed",
}[status] || status);

const money = (amount: number, currency = "PLN") => new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency,
}).format(Number(amount || 0));

const recoveryDuration = (openedAt: string | null, recoveredAt: string | null): string => {
  if (!openedAt || !recoveredAt) return "-";
  const minutes = Math.max(0, dayjs(recoveredAt).diff(dayjs(openedAt), "minute"));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} hr`;
};

const recoveryDate = (value: string | null): string => (
  value ? dayjs(value).format("D MMM YYYY, HH:mm:ss") : "-"
);

const customerCountry = (countryCode: string): string => (
  countryCode ? regionNames.of(countryCode) || countryCode : ""
);

const customerPhone = (customer: {
  phoneCountry?: string | null;
  phone?: string | null;
}): string => {
  const phone = String(customer.phone || "").trim();
  if (!phone || phone.startsWith("+")) return phone;
  try {
    return `+${getCountryCallingCode(customer.phoneCountry as CountryCode)} ${phone}`;
  } catch {
    return phone;
  }
};

type OngoingCartQuoteItem = OngoingCart["quote"]["items"][number];

const participantSummary = (item: OngoingCartQuoteItem): string => {
  const rawParticipants = item.options?.participants;
  if (rawParticipants && typeof rawParticipants === "object" && !Array.isArray(rawParticipants)) {
    const participants = rawParticipants as Record<string, unknown>;
    const men = Math.max(0, Number(participants.men) || 0);
    const women = Math.max(0, Number(participants.women) || 0);
    const parts = [
      men > 0 ? `${men} ${men === 1 ? "man" : "men"}` : "",
      women > 0 ? `${women} ${women === 1 ? "woman" : "women"}` : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }
  return `${item.quantity} ${item.quantity === 1 ? "guest" : "guests"}`;
};

const addonSummary = (addon: OngoingCartQuoteItem["addons"][number]): string => {
  const variants = (addon.variants || [])
    .filter((variant) => Number(variant.quantity) > 0)
    .map((variant) => `${variant.value} x ${variant.quantity}`);
  const selectedValue = addon.value && addon.value !== "true" ? addon.value : "";
  const selection = variants.length > 0
    ? variants.join(", ")
    : selectedValue
      ? selectedValue
      : `x ${addon.quantity}`;
  return `${addon.name}: ${selection}`;
};

const ExperienceDetails = ({ item }: { item: OngoingCartQuoteItem }) => (
  <Stack gap={3} miw={230}>
    <Text size="sm" fw={700}>{item.quantity} x {item.productName}</Text>
    {(item.experienceDate || item.experienceTime) && (
      <Text size="xs" c="dimmed">
        {[
          item.experienceDate ? dayjs(item.experienceDate).format("D MMM YYYY") : "",
          item.experienceTime || "",
        ].filter(Boolean).join(" | ")}
      </Text>
    )}
    <Text size="xs">{participantSummary(item)}</Text>
    {(item.addons || []).map((addon) => (
      <Text key={`${addon.name}-${addon.value}-${addon.quantity}`} size="xs" c="dimmed">
        Add-on: {addonSummary(addon)}
      </Text>
    ))}
  </Stack>
);

const BankTransferStatusDetails = ({
  order,
  align = "flex-start",
}: {
  order: BankTransferOrder;
  align?: "flex-start" | "flex-end";
}) => {
  const dueState = bankTransferDueState(order);
  return (
    <Stack gap={4} align={align}>
      <Badge color={bankTransferStatusColor(order.status)} variant="light">
        {order.status === "cancelled" && order.cancellationReason === "payment_deadline_expired"
          ? "Expired"
          : bankTransferStatusLabel(order.status)}
      </Badge>
      {order.paymentReference && (
        <Text size="xs" c="dimmed">Ref {order.paymentReference}</Text>
      )}
      {dueState && <Text size="xs" fw={dueState.color === "red" ? 700 : 500} c={dueState.color}>{dueState.label}</Text>}
    </Stack>
  );
};

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
};

const createClientRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const bankTransferStatusColor = (status: BankTransferOrder["status"]): string => (
  status === "payment_received" ? "green" : status === "cancelled" ? "gray" : "orange"
);

const bankTransferStatusLabel = (status: BankTransferOrder["status"]): string => (
  status === "payment_received" ? "Payment received" : status === "cancelled" ? "Cancelled" : "Awaiting transfer"
);

const bankTransferDueState = (order: BankTransferOrder): { color: string; label: string } | null => {
  if (order.status !== "awaiting_transfer" || !order.paymentDueAt) return null;
  const dueAt = dayjs(order.paymentDueAt);
  if (!dueAt.isValid()) return null;
  if (dayjs().isAfter(dueAt)) {
    return { color: "red", label: `Overdue since ${dueAt.format("D MMM YYYY, HH:mm")}` };
  }
  if (dueAt.isSame(dayjs(), "day")) {
    return { color: "orange", label: `Due today, ${dueAt.format("HH:mm")}` };
  }
  return { color: "dimmed", label: `Due ${dueAt.format("D MMM YYYY, HH:mm")}` };
};

const bankTransferEmailState = (order: BankTransferOrder): { color: string; label: string } => {
  if (order.status === "cancelled") {
    return order.bankTransferCancellationEmailSentAt
      ? { color: "gray", label: "Cancellation sent" }
      : { color: "orange", label: "Cancellation pending" };
  }
  if (order.status === "payment_received") {
    return order.confirmationEmailComplete
      ? { color: "green", label: "Confirmation sent" }
      : { color: "orange", label: "Confirmation pending" };
  }
  return order.bankTransferInstructionsEmailSentAt
    ? { color: "green", label: "Instructions sent" }
    : { color: "orange", label: "Instructions pending" };
};

const shortOrderReference = (publicId: string): string => {
  const normalized = publicId.trim();
  return normalized.length > 12 ? normalized.slice(0, 8).toUpperCase() : normalized.toUpperCase();
};

const errorMessage = (error: unknown): string => {
  const payload = error as { response?: { data?: { message?: string; error?: { message?: string } } }; message?: string };
  return payload.response?.data?.message || payload.response?.data?.error?.message || payload.message || "Request failed.";
};

const addonCap = (addon: StorefrontAddon, participants: number): number => {
  const configured = Number(addon.config.maxQuantity);
  const attendeeCap = addon.maxPerAttendee
    ? addon.maxPerAttendee * participants
    : Number.isInteger(configured) && configured > 0 ? configured : 50;
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, attendeeCap) : attendeeCap;
};

const PaymentLinksPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const modulePermissions = useModuleAccess("booking-management");
  const bankTransferPermissions = useModuleAccess(BANK_TRANSFER_BOOKINGS_MODULE);
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [paymentLinkProducts, setPaymentLinkProducts] = useState<StorefrontProduct[]>([]);
  const [bankTransferProducts, setBankTransferProducts] = useState<StorefrontProduct[]>([]);
  const [paymentLinkCatalogLoading, setPaymentLinkCatalogLoading] = useState(true);
  const [paymentLinkCatalogError, setPaymentLinkCatalogError] = useState("");
  const [bankTransferCatalogLoading, setBankTransferCatalogLoading] = useState(true);
  const [bankTransferCatalogError, setBankTransferCatalogError] = useState("");
  const [links, setLinks] = useState<SavedCart[]>([]);
  const [ongoingCarts, setOngoingCarts] = useState<OngoingCart[]>([]);
  const [recoveredCarts, setRecoveredCarts] = useState<OngoingCart[]>([]);
  const [bankTransferOrders, setBankTransferOrders] = useState<BankTransferOrder[]>([]);
  const [bankTransferLoading, setBankTransferLoading] = useState(true);
  const [bankTransferError, setBankTransferError] = useState("");
  const [bankTransferNotice, setBankTransferNotice] = useState<BankTransferNotice | null>(null);
  const [showCancelledBankTransfers, setShowCancelledBankTransfers] = useState(false);
  const [resendingOrderId, setResendingOrderId] = useState<string | null>(null);
  const [retryingConfirmationOrderId, setRetryingConfirmationOrderId] = useState<string | null>(null);
  const [resendingCancellationOrderId, setResendingCancellationOrderId] = useState<string | null>(null);
  const [sendingRecoveryId, setSendingRecoveryId] = useState<string | null>(null);
  const [previewingRecoveryId, setPreviewingRecoveryId] = useState<string | null>(null);
  const [recoveryEmailPreview, setRecoveryEmailPreview] = useState<RecoveryEmailPreview | null>(null);
  const [activityCart, setActivityCart] = useState<OngoingCart | null>(null);
  const [activity, setActivity] = useState<CartActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const requestedTab = storefrontCartTab(searchParams.get("tab"));
  const activeTab = requestedTab === "bank-transfers"
    ? bankTransferPermissions.canView
      ? "bank-transfers"
      : modulePermissions.canView
        ? "prepared"
        : "bank-transfers"
    : modulePermissions.canView
      ? requestedTab
      : bankTransferPermissions.canView
        ? "bank-transfers"
        : requestedTab;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [creatorMode, setCreatorMode] = useState<CreatorMode>("payment-link");
  const [clientRequestId, setClientRequestId] = useState(createClientRequestId);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [formError, setFormError] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | string>(7);
  const [discountCodes, setDiscountCodes] = useState("");
  const [customer, setCustomer] = useState({ fullName: "", email: "", phoneCountry: "", phone: "" });
  const [items, setItems] = useState<CartItemDraft[]>([emptyItem()]);
  const [receivingOrder, setReceivingOrder] = useState<BankTransferOrder | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentReceivedRequestId, setPaymentReceivedRequestId] = useState(createClientRequestId);
  const [paymentReceivedSaving, setPaymentReceivedSaving] = useState(false);
  const [paymentReceivedError, setPaymentReceivedError] = useState("");
  const [cancellingOrder, setCancellingOrder] = useState<BankTransferOrder | null>(null);
  const [cancellationNote, setCancellationNote] = useState("");
  const [cancellationSaving, setCancellationSaving] = useState(false);
  const [cancellationError, setCancellationError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [linksResponse, ongoingResponse, recoveredResponse] = await Promise.all([
        axiosInstance.get<{ data: SavedCart[] }>("/storefront-saved-carts"),
        axiosInstance.get<{ data: OngoingCart[] }>("/storefront-ongoing-carts"),
        axiosInstance.get<{ data: OngoingCart[] }>("/storefront-ongoing-carts/recovered"),
      ]);
      setLinks(linksResponse.data.data || []);
      setOngoingCarts(ongoingResponse.data.data || []);
      setRecoveredCarts(recoveredResponse.data.data || []);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPaymentLinkCatalog = useCallback(async () => {
    setPaymentLinkCatalogLoading(true);
    setPaymentLinkCatalogError("");
    try {
      const response = await axiosInstance.get<{ products: StorefrontProduct[] }>("/storefront/products");
      setPaymentLinkProducts(response.data.products || []);
    } catch (requestError) {
      setPaymentLinkCatalogError(errorMessage(requestError));
    } finally {
      setPaymentLinkCatalogLoading(false);
    }
  }, []);

  const loadBankTransferCatalog = useCallback(async () => {
    setBankTransferCatalogLoading(true);
    setBankTransferCatalogError("");
    try {
      const response = await axiosInstance.get<{ products: StorefrontProduct[] }>(
        "/storefront-bank-transfer-orders/catalog",
      );
      setBankTransferProducts(response.data.products || []);
    } catch (requestError) {
      setBankTransferCatalogError(errorMessage(requestError));
    } finally {
      setBankTransferCatalogLoading(false);
    }
  }, []);

  const loadBankTransferOrders = useCallback(async () => {
    setBankTransferLoading(true);
    setBankTransferError("");
    try {
      const response = await axiosInstance.get<{ data: BankTransferOrder[] }>(
        `/storefront-bank-transfer-orders${showCancelledBankTransfers ? "?includeCancelled=true" : ""}`,
      );
      setBankTransferOrders(response.data.data || []);
    } catch (requestError) {
      setBankTransferError(errorMessage(requestError));
    } finally {
      setBankTransferLoading(false);
    }
  }, [showCancelledBankTransfers]);

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) return;
    void load();
    void loadPaymentLinkCatalog();
  }, [load, loadPaymentLinkCatalog, modulePermissions.canView, modulePermissions.ready]);

  useEffect(() => {
    if (
      !bankTransferPermissions.ready
      || !bankTransferPermissions.canView
      || activeTab !== "bank-transfers"
    ) return;
    void loadBankTransferOrders();
  }, [
    activeTab,
    bankTransferPermissions.canView,
    bankTransferPermissions.ready,
    loadBankTransferOrders,
  ]);

  useEffect(() => {
    if (
      !bankTransferPermissions.ready
      || !bankTransferPermissions.canView
      || activeTab !== "bank-transfers"
    ) return;
    void loadBankTransferCatalog();
  }, [
    activeTab,
    bankTransferPermissions.canView,
    bankTransferPermissions.ready,
    loadBankTransferCatalog,
  ]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;
    if (searchParams.get("tab") !== activeTab) {
      nextParams.set("tab", activeTab);
      changed = true;
    }
    if (
      bankTransferPermissions.ready
      && searchParams.get("action") === "create-bank-transfer"
      && (!bankTransferPermissions.canView || !bankTransferPermissions.canCreate)
    ) {
      nextParams.delete("action");
      changed = true;
    }
    if (!changed) return;
    setSearchParams(nextParams, { replace: true });
  }, [
    activeTab,
    bankTransferPermissions.canCreate,
    bankTransferPermissions.canView,
    bankTransferPermissions.ready,
    searchParams,
    setSearchParams,
  ]);

  const changeTab = (value: string | null) => {
    if (!value || !storefrontCartTabs.has(value as StorefrontCartTab)) return;
    if (value === "bank-transfers" && !bankTransferPermissions.canView) return;
    if (value !== "bank-transfers" && !modulePermissions.canView) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", value);
    setSearchParams(nextParams, { replace: false });
  };

  const creatorProducts = creatorMode === "bank-transfer"
    ? bankTransferProducts
    : paymentLinkProducts;
  const productById = useMemo(
    () => new Map(creatorProducts.map((product) => [product.id, product])),
    [creatorProducts],
  );

  const resetForm = useCallback(() => {
    setName("");
    setExpiresInDays(7);
    setDiscountCodes("");
    setCustomer({ fullName: "", email: "", phoneCountry: "", phone: "" });
    setItems([emptyItem()]);
    setQuote(null);
    setFormError("");
    setClientRequestId(createClientRequestId());
  }, []);

  const openCreator = useCallback(() => {
    resetForm();
    setCreatorMode("payment-link");
    setModalOpen(true);
  }, [resetForm]);

  const openBankTransferCreator = useCallback(() => {
    resetForm();
    setBankTransferNotice(null);
    setCreatorMode("bank-transfer");
    setModalOpen(true);
  }, [resetForm]);

  useEffect(() => {
    if (
      searchParams.get("action") !== "create-bank-transfer"
      || !bankTransferPermissions.ready
      || !bankTransferPermissions.canView
      || !bankTransferPermissions.canCreate
    ) {
      return;
    }
    openBankTransferCreator();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", "bank-transfers");
    nextParams.delete("action");
    setSearchParams(nextParams, { replace: true });
  }, [
    bankTransferPermissions.canCreate,
    bankTransferPermissions.canView,
    bankTransferPermissions.ready,
    openBankTransferCreator,
    searchParams,
    setSearchParams,
  ]);

  const updateItem = (key: string, patch: Partial<CartItemDraft>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
    setQuote(null);
  };

  const selectProduct = (item: CartItemDraft, productId: string | null) => {
    const product = productId ? productById.get(Number(productId)) : null;
    if (!product) {
      updateItem(item.key, { productId: null, addons: {} });
      return;
    }
    const minimum = Math.max(1, Number(product.config.minParticipants || 1));
    updateItem(item.key, {
      productId: product.id,
      quantity: minimum,
      men: product.config.participantMode === "gender_split" ? minimum : 0,
      women: 0,
      experienceTime: product.config.timeMode === "fixed" ? product.config.defaultStartTime || "" : "",
      addons: {},
    });
  };

  const updateAddon = (item: CartItemDraft, addonId: number, patch: Partial<AddonDraft>) => {
    const current = item.addons[addonId] || { enabled: false, quantity: 0, value: "", variants: {} };
    updateItem(item.key, { addons: { ...item.addons, [addonId]: { ...current, ...patch } } });
  };

  const cartPayload = () => {
    const cartItems = items.map((item, index) => {
      const product = item.productId ? productById.get(item.productId) : null;
      if (!product) throw new Error(`Select a product for experience ${index + 1}.`);
      const genderSplit = product.config.participantMode === "gender_split";
      const quantity = genderSplit ? item.men + item.women : item.quantity;
      if (quantity < Math.max(1, Number(product.config.minParticipants || 1))) {
        throw new Error(`${product.name} does not have enough participants.`);
      }
      if (product.config.dateRequired && !item.experienceDate) {
        throw new Error(`Select a date for ${product.name}.`);
      }
      const addons = product.addons.flatMap<CartAddonInput>((addon) => {
        const draft = item.addons[addon.id];
        const mode = addon.config.selectionMode || "boolean";
        if (!draft) return [];
        if (mode === "options") {
          return draft.value ? [{ addonId: addon.id, value: draft.value, quantity: 1 }] : [];
        }
        if (!draft.enabled || draft.quantity < 1) return [];
        const variants = addon.inventory.variantSelectionRequired
          ? addon.inventory.variants.flatMap((variant) => {
            const variantQuantity = Number(draft.variants[variant.value] || 0);
            return variantQuantity > 0 ? [{ value: variant.value, quantity: variantQuantity }] : [];
          })
          : [];
        if (addon.inventory.variantSelectionRequired) {
          const selected = variants.reduce((sum, variant) => sum + variant.quantity, 0);
          if (selected !== draft.quantity) {
            throw new Error(`${addon.name} sizes must add up to ${draft.quantity}.`);
          }
        }
        return [{ addonId: addon.id, quantity: draft.quantity, variants }];
      });
      return {
        productId: product.id,
        quantity,
        experienceDate: item.experienceDate || null,
        experienceTime: item.experienceTime || null,
        addons,
        options: genderSplit ? { participants: { men: item.men, women: item.women } } : {},
      };
    });
    const codes = discountCodes.split(/[\s,]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
    return { items: cartItems, discountCodes: codes, discountCode: codes[0] || null };
  };

  const preview = async (): Promise<Quote | null> => {
    setPreviewing(true);
    setFormError("");
    try {
      const response = await axiosInstance.post<{ quote: Quote }>("/storefront-saved-carts/preview", {
        cart: cartPayload(),
      });
      setQuote(response.data.quote);
      return response.data.quote;
    } catch (requestError) {
      setFormError(errorMessage(requestError));
      return null;
    } finally {
      setPreviewing(false);
    }
  };

  const create = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (creatorMode === "bank-transfer") {
        if (!customer.fullName.trim()) {
          throw new Error("Enter the customer's full name.");
        }
        if (!customer.email.trim()) {
          throw new Error("Enter the customer's email address so confirmation can be delivered.");
        }
        const response = await axiosInstance.post<{ data: BankTransferOrder; warning?: string }>(
          "/storefront-bank-transfer-orders",
          {
            customer: {
              fullName: customer.fullName.trim(),
              email: customer.email.trim(),
              phoneCountry: customer.phoneCountry,
              phone: customer.phone.trim(),
            },
            cart: cartPayload(),
            clientRequestId,
          },
        );
        setBankTransferOrders((current) => [
          response.data.data,
          ...current.filter((order) => order.publicId !== response.data.data.publicId),
        ]);
        setBankTransferNotice(response.data.warning ? {
          color: "yellow",
          title: "Booking created, but email needs attention",
          message: response.data.warning,
        } : {
          color: "green",
          title: "Booking created",
          message: `Bank transfer instructions were sent to ${response.data.data.customer.email}.`,
        });
        setModalOpen(false);
        return;
      }
      const response = await axiosInstance.post<{ data: SavedCart }>("/storefront-saved-carts", {
        name,
        expiresInDays: Number(expiresInDays),
        customer,
        cart: cartPayload(),
      });
      setLinks((current) => [response.data.data, ...current]);
      setModalOpen(false);
      try {
        await copyText(`${storefrontBaseUrl}/cart?shared=${response.data.data.publicId}`);
      } catch {
        // The link remains available in the table when browser clipboard access is denied.
      }
    } catch (requestError) {
      setFormError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const openPaymentReceived = (order: BankTransferOrder) => {
    setBankTransferNotice(null);
    setReceivingOrder(order);
    setPaymentReference("");
    setPaymentNote("");
    setPaymentReceivedRequestId(createClientRequestId());
    setPaymentReceivedError("");
  };

  const closePaymentReceived = () => {
    if (paymentReceivedSaving) return;
    setReceivingOrder(null);
    setPaymentReceivedError("");
  };

  const markPaymentReceived = async () => {
    if (!receivingOrder) return;
    setPaymentReceivedSaving(true);
    setPaymentReceivedError("");
    try {
      const response = await axiosInstance.patch<{ data: BankTransferOrder }>(
        `/storefront-bank-transfer-orders/${encodeURIComponent(receivingOrder.publicId)}/payment-received`,
        {
          ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
          ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
          clientRequestId: paymentReceivedRequestId,
        },
      );
      setBankTransferOrders((current) => current.map((order) => (
        order.publicId === response.data.data.publicId ? response.data.data : order
      )));
      setBankTransferNotice({
        color: "green",
        title: "Payment recorded",
        message: `${response.data.data.customer.fullName}'s booking is now paid.`,
      });
      setReceivingOrder(null);
    } catch (requestError) {
      setPaymentReceivedError(errorMessage(requestError));
    } finally {
      setPaymentReceivedSaving(false);
    }
  };

  const resendBankTransferInstructions = async (order: BankTransferOrder) => {
    setResendingOrderId(order.publicId);
    setBankTransferNotice(null);
    try {
      const response = await axiosInstance.post<{ data: BankTransferOrder }>(
        `/storefront-bank-transfer-orders/${encodeURIComponent(order.publicId)}/resend-instructions`,
      );
      setBankTransferOrders((current) => current.map((currentOrder) => (
        currentOrder.publicId === response.data.data.publicId ? response.data.data : currentOrder
      )));
      setBankTransferNotice({
        color: "green",
        title: "Instructions sent",
        message: `Bank transfer instructions were sent to ${response.data.data.customer.email}.`,
      });
    } catch (requestError) {
      setBankTransferNotice({
        color: "red",
        title: "Unable to send instructions",
        message: errorMessage(requestError),
      });
    } finally {
      setResendingOrderId(null);
    }
  };

  const retryBankTransferConfirmation = async (order: BankTransferOrder) => {
    setRetryingConfirmationOrderId(order.publicId);
    setBankTransferNotice(null);
    try {
      const response = await axiosInstance.post<{ data: BankTransferOrder }>(
        `/storefront-bank-transfer-orders/${encodeURIComponent(order.publicId)}/retry-confirmation`,
      );
      setBankTransferOrders((current) => current.map((currentOrder) => (
        currentOrder.publicId === response.data.data.publicId ? response.data.data : currentOrder
      )));
      setBankTransferNotice({
        color: "green",
        title: "Confirmation sent",
        message: `The booking confirmation was sent to ${response.data.data.customer.email}.`,
      });
    } catch (requestError) {
      setBankTransferNotice({
        color: "red",
        title: "Unable to send confirmation",
        message: errorMessage(requestError),
      });
    } finally {
      setRetryingConfirmationOrderId(null);
    }
  };

  const openBankTransferCancellation = (order: BankTransferOrder) => {
    setBankTransferNotice(null);
    setCancellingOrder(order);
    setCancellationNote("");
    setCancellationError("");
  };

  const closeBankTransferCancellation = () => {
    if (cancellationSaving) return;
    setCancellingOrder(null);
    setCancellationError("");
  };

  const cancelBankTransferReservation = async () => {
    if (!cancellingOrder) return;
    setCancellationSaving(true);
    setCancellationError("");
    try {
      const response = await axiosInstance.patch<{ data: BankTransferOrder; warning?: string }>(
        `/storefront-bank-transfer-orders/${encodeURIComponent(cancellingOrder.publicId)}/cancel`,
        cancellationNote.trim() ? { note: cancellationNote.trim() } : {},
      );
      setBankTransferOrders((current) => showCancelledBankTransfers
        ? current.map((order) => order.publicId === response.data.data.publicId ? response.data.data : order)
        : current.filter((order) => order.publicId !== response.data.data.publicId));
      setBankTransferNotice(response.data.warning ? {
        color: "yellow",
        title: "Reservation cancelled, but email needs attention",
        message: `${response.data.warning} Show cancelled bookings to retry it.`,
      } : {
        color: "green",
        title: "Reservation cancelled",
        message: `${response.data.data.customer.fullName}'s unpaid reservation was cancelled and the customer was notified.`,
      });
      setCancellingOrder(null);
    } catch (requestError) {
      setCancellationError(errorMessage(requestError));
    } finally {
      setCancellationSaving(false);
    }
  };

  const resendBankTransferCancellation = async (order: BankTransferOrder) => {
    setResendingCancellationOrderId(order.publicId);
    setBankTransferNotice(null);
    try {
      const response = await axiosInstance.post<{ data: BankTransferOrder }>(
        `/storefront-bank-transfer-orders/${encodeURIComponent(order.publicId)}/resend-cancellation`,
      );
      setBankTransferOrders((current) => current.map((currentOrder) => (
        currentOrder.publicId === response.data.data.publicId ? response.data.data : currentOrder
      )));
      setBankTransferNotice({
        color: "green",
        title: "Cancellation email sent",
        message: `The cancellation notice was sent to ${response.data.data.customer.email}.`,
      });
    } catch (requestError) {
      setBankTransferNotice({
        color: "red",
        title: "Unable to send cancellation email",
        message: errorMessage(requestError),
      });
    } finally {
      setResendingCancellationOrderId(null);
    }
  };

  const copyLink = async (savedCart: SavedCart) => {
    await copyText(`${storefrontBaseUrl}/cart?shared=${savedCart.publicId}`);
  };

  const disable = async (savedCart: SavedCart) => {
    if (!window.confirm(`Disable the payment link for ${savedCart.name}?`)) return;
    try {
      const response = await axiosInstance.patch<{ data: SavedCart }>(
        `/storefront-saved-carts/${savedCart.publicId}/disable`,
      );
      setLinks((current) => current.map((item) => item.publicId === savedCart.publicId ? response.data.data : item));
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  const dismissOngoing = async (ongoingCart: OngoingCart) => {
    if (!window.confirm(`Dismiss the ongoing cart for ${ongoingCart.customer.fullName}?`)) return;
    try {
      await axiosInstance.patch(`/storefront-ongoing-carts/${ongoingCart.publicId}/dismiss`);
      setOngoingCarts((current) => current.filter((item) => item.publicId !== ongoingCart.publicId));
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  const copyRecoveryLink = async (ongoingCart: OngoingCart) => {
    await copyText(`${storefrontBaseUrl}/cart?recover=${ongoingCart.publicId}`);
  };

  const openCartActivity = async (ongoingCart: OngoingCart) => {
    setActivityCart(ongoingCart);
    setActivity(null);
    setActivityLoading(true);
    try {
      const response = await axiosInstance.get<{ data: CartActivity }>(
        `/storefront-ongoing-carts/${ongoingCart.publicId}/activity`,
      );
      setActivity(response.data.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setActivityLoading(false);
    }
  };

  const previewRecoveryEmail = async (ongoingCart: OngoingCart) => {
    setPreviewingRecoveryId(ongoingCart.publicId);
    setError("");
    try {
      const response = await axiosInstance.get<{ data: Omit<RecoveryEmailPreview, "cart"> }>(
        `/storefront-ongoing-carts/${ongoingCart.publicId}/recovery-preview`,
      );
      setRecoveryEmailPreview({ cart: ongoingCart, ...response.data.data });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPreviewingRecoveryId(null);
    }
  };

  const sendRecoveryEmail = async (ongoingCart: OngoingCart) => {
    setSendingRecoveryId(ongoingCart.publicId);
    setError("");
    try {
      const response = await axiosInstance.post<{ data: OngoingCart }>(
        `/storefront-ongoing-carts/${ongoingCart.publicId}/send-recovery`,
      );
      setOngoingCarts((current) => current.map((item) => (
        item.publicId === ongoingCart.publicId ? response.data.data : item
      )));
      setRecoveryEmailPreview(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSendingRecoveryId(null);
    }
  };

  const sortedBankTransferOrders = useMemo(
    () => [...bankTransferOrders].sort((left, right) => {
      if (left.status !== right.status) {
        const rank: Record<BankTransferOrder["status"], number> = {
          awaiting_transfer: 0,
          payment_received: 1,
          cancelled: 2,
        };
        return rank[left.status] - rank[right.status];
      }
      if (left.status === "awaiting_transfer") {
        const leftDueAt = left.paymentDueAt ? dayjs(left.paymentDueAt) : null;
        const rightDueAt = right.paymentDueAt ? dayjs(right.paymentDueAt) : null;
        const leftDueValue = leftDueAt?.isValid() ? leftDueAt.valueOf() : Number.POSITIVE_INFINITY;
        const rightDueValue = rightDueAt?.isValid() ? rightDueAt.valueOf() : Number.POSITIVE_INFINITY;
        if (leftDueValue !== rightDueValue) return leftDueValue - rightDueValue;
      }
      return dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf();
    }),
    [bankTransferOrders],
  );

  if (
    !modulePermissions.ready
    || modulePermissions.loading
    || !bankTransferPermissions.ready
    || bankTransferPermissions.loading
  ) {
    return (
      <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>
        <Box mih={260} style={{ display: "grid", placeItems: "center" }}>
          <Loader />
        </Box>
      </PageAccessGuard>
    );
  }

  if (!modulePermissions.canView && !bankTransferPermissions.canView) {
    return (
      <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>
        <Alert m={{ base: "md", md: "xl" }} color="yellow" title="No access">
          You do not have permission to view direct-sales booking information.
        </Alert>
      </PageAccessGuard>
    );
  }

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>
      <Stack gap="lg" p={{ base: "md", md: "xl" }}>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Box>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">Bookings</Text>
            <Title order={1} size="h2">Direct sales</Title>
            <Text c="dimmed">Create direct bookings and manage customer payment journeys.</Text>
          </Box>
          <Group>
            <Tooltip label="Refresh statuses">
              <Button
                variant="default"
                px="sm"
                onClick={() => {
                  if (activeTab === "bank-transfers" && bankTransferPermissions.canView) {
                    void loadBankTransferOrders();
                    void loadBankTransferCatalog();
                  } else if (modulePermissions.canView) {
                    void load();
                    void loadPaymentLinkCatalog();
                  }
                }}
                aria-label="Refresh direct sales"
              >
                <IconRefresh size={18} />
              </Button>
            </Tooltip>
            {activeTab === "prepared" && modulePermissions.canCreate && (
              <Button
                leftSection={<IconPlus size={18} />}
                onClick={openCreator}
                disabled={paymentLinkCatalogLoading || Boolean(paymentLinkCatalogError)}
              >
                New payment link
              </Button>
            )}
            {activeTab === "bank-transfers" && bankTransferPermissions.canCreate && (
              <Button
                leftSection={<IconBuildingBank size={18} />}
                onClick={openBankTransferCreator}
                disabled={bankTransferCatalogLoading || Boolean(bankTransferCatalogError)}
              >
                New booking
              </Button>
            )}
          </Group>
        </Group>

        <Group gap="xs">
          <Button variant="subtle" onClick={() => navigate("/bookings")}>Calendar</Button>
          <Button variant="light" leftSection={<IconLink size={17} />}>Direct sales</Button>
        </Group>

        <Tabs value={activeTab} onChange={changeTab}>
          <Tabs.List style={{ flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden" }}>
            {modulePermissions.canView && (
              <Tabs.Tab style={{ flexShrink: 0 }} value="prepared" leftSection={<IconLink size={16} />}>Prepared links</Tabs.Tab>
            )}
            {bankTransferPermissions.canView && (
              <Tabs.Tab style={{ flexShrink: 0 }} value="bank-transfers" leftSection={<IconBuildingBank size={16} />}>
                Bank transfers
              </Tabs.Tab>
            )}
            {modulePermissions.canView && (
              <>
                <Tabs.Tab style={{ flexShrink: 0 }} value="ongoing" leftSection={<IconShoppingCart size={16} />}>Ongoing carts</Tabs.Tab>
                <Tabs.Tab style={{ flexShrink: 0 }} value="recovered" leftSection={<IconShoppingCart size={16} />}>Recovered sales</Tabs.Tab>
              </>
            )}
          </Tabs.List>
        </Tabs>

        {activeTab === "bank-transfers" && (
          <Group justify="flex-end">
            <Switch
              label="Show cancelled bookings"
              checked={showCancelledBankTransfers}
              onChange={(event) => setShowCancelledBankTransfers(event.currentTarget.checked)}
            />
          </Group>
        )}

        {activeTab !== "bank-transfers" && error && (
          <Alert color="red" title="Direct sales data unavailable">{error}</Alert>
        )}
        {activeTab !== "bank-transfers" && paymentLinkCatalogError && (
          <Alert color="red" title="Experience catalog unavailable">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">{paymentLinkCatalogError}</Text>
              <Button variant="light" color="red" size="xs" onClick={() => void loadPaymentLinkCatalog()}>
                Try again
              </Button>
            </Group>
          </Alert>
        )}
        {activeTab === "bank-transfers" && bankTransferCatalogError && (
          <Alert color="red" title="Experience catalog unavailable">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">{bankTransferCatalogError}</Text>
              <Button variant="light" color="red" size="xs" onClick={() => void loadBankTransferCatalog()}>
                Try again
              </Button>
            </Group>
          </Alert>
        )}
        {activeTab === "bank-transfers" && bankTransferNotice && (
          <Alert
            color={bankTransferNotice.color}
            title={bankTransferNotice.title}
            withCloseButton
            onClose={() => setBankTransferNotice(null)}
          >
            {bankTransferNotice.message}
          </Alert>
        )}

        {activeTab !== "bank-transfers" && loading ? (
          <Box mih={260} style={{ display: "grid", placeItems: "center" }}><Loader /></Box>
        ) : activeTab === "prepared" && links.length === 0 ? (
          <Box py={80} ta="center">
            <IconLink size={34} color="var(--mantine-color-gray-5)" />
            <Title order={3} mt="sm">No payment links yet</Title>
            <Text c="dimmed" mb="lg">Create a prepared booking when a customer is ready to pay.</Text>
            {modulePermissions.canCreate && (
              <Button
                leftSection={<IconPlus size={18} />}
                onClick={openCreator}
                disabled={paymentLinkCatalogLoading || Boolean(paymentLinkCatalogError)}
              >
                New payment link
              </Button>
            )}
          </Box>
        ) : activeTab === "prepared" ? (
          <Box style={{ overflowX: "auto" }}>
            <Table verticalSpacing="md" horizontalSpacing="md" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Customer / cart</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Total</Table.Th>
                  <Table.Th>Expires</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {links.map((savedCart) => {
                  const usable = !["paid", "expired", "disabled"].includes(savedCart.status);
                  const url = `${storefrontBaseUrl}/cart?shared=${savedCart.publicId}`;
                  return (
                    <Table.Tr key={savedCart.publicId}>
                      <Table.Td>
                        <Text fw={700}>{savedCart.name}</Text>
                        {savedCart.orderPublicId && <Text size="xs" c="dimmed">Order {savedCart.orderPublicId}</Text>}
                      </Table.Td>
                      <Table.Td><Badge color={statusColor(savedCart.status)} variant="light">{statusLabel(savedCart.status)}</Badge></Table.Td>
                      <Table.Td fw={700}>{money(savedCart.total, savedCart.currency)}</Table.Td>
                      <Table.Td>{dayjs(savedCart.expiresAt).format("D MMM YYYY, HH:mm")}</Table.Td>
                      <Table.Td>{dayjs(savedCart.createdAt).format("D MMM YYYY")}</Table.Td>
                      <Table.Td>
                        <Group justify="flex-end" gap="xs" wrap="nowrap">
                          {usable && <Tooltip label="Copy link"><Button variant="subtle" px="xs" onClick={() => void copyLink(savedCart)} aria-label="Copy payment link"><IconCopy size={18} /></Button></Tooltip>}
                          {usable && <Tooltip label="Open link"><Button component="a" href={url} target="_blank" rel="noreferrer" variant="subtle" px="xs" aria-label="Open payment link"><IconExternalLink size={18} /></Button></Tooltip>}
                          {usable && <Tooltip label="Disable link"><Button color="red" variant="subtle" px="xs" onClick={() => void disable(savedCart)} aria-label="Disable payment link"><IconBan size={18} /></Button></Tooltip>}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
        ) : activeTab === "bank-transfers" && bankTransferLoading ? (
          <Box mih={260} style={{ display: "grid", placeItems: "center" }}>
            <Loader />
          </Box>
        ) : activeTab === "bank-transfers" && bankTransferError ? (
          <Alert
            color="red"
            title="Bank transfer bookings unavailable"
            withCloseButton={false}
          >
            <Stack gap="sm" align="flex-start">
              <Text size="sm">{bankTransferError}</Text>
              <Button variant="light" color="red" size="xs" onClick={() => void loadBankTransferOrders()}>
                Try again
              </Button>
            </Stack>
          </Alert>
        ) : activeTab === "bank-transfers" && sortedBankTransferOrders.length === 0 ? (
          <Box py={80} ta="center">
            <IconBuildingBank size={38} color="var(--mantine-color-gray-5)" />
            <Title order={3} mt="sm">No bank transfer bookings</Title>
            <Text c="dimmed" mb="lg">Create a reserved booking and send the customer transfer instructions.</Text>
            {bankTransferPermissions.canCreate && (
              <Button
                leftSection={<IconBuildingBank size={18} />}
                onClick={openBankTransferCreator}
                disabled={bankTransferCatalogLoading || Boolean(bankTransferCatalogError)}
              >
                New booking
              </Button>
            )}
          </Box>
        ) : activeTab === "bank-transfers" ? (
          <>
            <Box visibleFrom="sm" style={{ overflowX: "auto" }}>
              <Table verticalSpacing="md" horizontalSpacing="md" striped highlightOnHover miw={1180}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Customer</Table.Th>
                    <Table.Th>Experiences</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Total</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Created</Table.Th>
                    <Table.Th>Received</Table.Th>
                    <Table.Th ta="right">Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedBankTransferOrders.map((order) => (
                    <Table.Tr key={order.publicId}>
                      <Table.Td>
                        <Text fw={700}>{order.customer.fullName}</Text>
                        <Text size="xs" c="dimmed">{order.customer.email}</Text>
                        {customerPhone(order.customer) && (
                          <Text size="xs" c="dimmed">{customerPhone(order.customer)}</Text>
                        )}
                        <Text size="xs" c="dimmed">Order {shortOrderReference(order.publicId)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap="sm">
                          {order.items.map((item, itemIndex) => (
                            <ExperienceDetails
                              key={`${order.publicId}-${item.productName}-${itemIndex}`}
                              item={item}
                            />
                          ))}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <BankTransferStatusDetails order={order} />
                      </Table.Td>
                      <Table.Td fw={700}>{money(order.total, order.currency)}</Table.Td>
                      <Table.Td>
                        <Badge
                          size="sm"
                          variant="light"
                          color={bankTransferEmailState(order).color}
                        >
                          {bankTransferEmailState(order).label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{dayjs(order.createdAt).format("D MMM YYYY, HH:mm")}</Text>
                        {order.createdBy && <Text size="xs" c="dimmed">by {order.createdBy.fullName}</Text>}
                      </Table.Td>
                      <Table.Td>
                        {order.paidAt ? (
                          <>
                            <Text size="sm">{dayjs(order.paidAt).format("D MMM YYYY, HH:mm")}</Text>
                            {order.receivedBy && <Text size="xs" c="dimmed">by {order.receivedBy.fullName}</Text>}
                            {order.receivedPaymentReference && (
                              <Text size="xs" c="dimmed">Bank ref: {order.receivedPaymentReference}</Text>
                            )}
                            {order.paymentNote && (
                              <Text size="xs" c="dimmed" lineClamp={2}>Note: {order.paymentNote}</Text>
                            )}
                          </>
                        ) : <Text size="sm" c="dimmed">-</Text>}
                      </Table.Td>
                      <Table.Td>
                        {order.status === "awaiting_transfer" && bankTransferPermissions.canUpdate ? (
                          <Stack gap="xs" miw={145}>
                            <Button
                              size="xs"
                              leftSection={<IconCircleCheck size={16} />}
                              onClick={() => openPaymentReceived(order)}
                            >
                              Mark received
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconSend size={16} />}
                              loading={resendingOrderId === order.publicId}
                              onClick={() => void resendBankTransferInstructions(order)}
                            >
                              {order.bankTransferInstructionsEmailSentAt ? "Resend" : "Send instructions"}
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              color="red"
                              leftSection={<IconBan size={16} />}
                              onClick={() => openBankTransferCancellation(order)}
                            >
                              Cancel booking
                            </Button>
                          </Stack>
                        ) : order.status === "payment_received"
                          && !order.confirmationEmailComplete
                          && bankTransferPermissions.canUpdate ? (
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconSend size={16} />}
                              loading={retryingConfirmationOrderId === order.publicId}
                              onClick={() => void retryBankTransferConfirmation(order)}
                            >
                              Retry confirmation
                            </Button>
                          ) : order.status === "cancelled"
                            && !order.bankTransferCancellationEmailSentAt
                            && bankTransferPermissions.canUpdate ? (
                              <Button
                                size="xs"
                                variant="light"
                                leftSection={<IconSend size={16} />}
                                loading={resendingCancellationOrderId === order.publicId}
                                onClick={() => void resendBankTransferCancellation(order)}
                              >
                                Retry cancellation email
                              </Button>
                          ) : null}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>

            <Stack hiddenFrom="sm" gap="md">
              {sortedBankTransferOrders.map((order) => (
                <Paper key={order.publicId} withBorder radius="lg" p="md" shadow="xs">
                  <Stack gap="md">
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Box style={{ minWidth: 0 }}>
                        <Text fw={700} truncate>{order.customer.fullName}</Text>
                        <Text size="xs" c="dimmed" truncate>{order.customer.email}</Text>
                        {customerPhone(order.customer) && (
                          <Text size="xs" c="dimmed">{customerPhone(order.customer)}</Text>
                        )}
                        <Text size="xs" c="dimmed">Order {shortOrderReference(order.publicId)}</Text>
                      </Box>
                      <BankTransferStatusDetails order={order} align="flex-end" />
                    </Group>

                    <Stack gap="sm">
                      {order.items.map((item, itemIndex) => (
                        <ExperienceDetails
                          key={`${order.publicId}-${item.productName}-${itemIndex}`}
                          item={item}
                        />
                      ))}
                    </Stack>

                    <Divider />
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">Total</Text>
                      <Text size="xl" fw={800}>{money(order.total, order.currency)}</Text>
                    </Group>
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Text size="xs" c="dimmed">
                        Created {dayjs(order.createdAt).format("D MMM, HH:mm")}
                        {order.createdBy ? ` by ${order.createdBy.fullName}` : ""}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={bankTransferEmailState(order).color}
                      >
                        {bankTransferEmailState(order).label}
                      </Badge>
                    </Group>
                    {order.paidAt && (
                      <Text size="xs" c="dimmed">
                        Received {dayjs(order.paidAt).format("D MMM YYYY, HH:mm")}
                        {order.receivedBy ? ` by ${order.receivedBy.fullName}` : ""}
                      </Text>
                    )}
                    {order.paidAt && order.receivedPaymentReference && (
                      <Text size="xs" c="dimmed">Bank ref: {order.receivedPaymentReference}</Text>
                    )}
                    {order.paidAt && order.paymentNote && (
                      <Text size="xs" c="dimmed">Note: {order.paymentNote}</Text>
                    )}
                    {order.status === "awaiting_transfer" && bankTransferPermissions.canUpdate && (
                      <Stack gap="xs">
                        <Button
                          fullWidth
                          leftSection={<IconCircleCheck size={18} />}
                          onClick={() => openPaymentReceived(order)}
                        >
                          Mark payment received
                        </Button>
                        <Button
                          fullWidth
                          variant="light"
                          leftSection={<IconSend size={18} />}
                          loading={resendingOrderId === order.publicId}
                          onClick={() => void resendBankTransferInstructions(order)}
                        >
                          {order.bankTransferInstructionsEmailSentAt ? "Resend instructions" : "Send instructions"}
                        </Button>
                        <Button
                          fullWidth
                          variant="subtle"
                          color="red"
                          leftSection={<IconBan size={18} />}
                          onClick={() => openBankTransferCancellation(order)}
                        >
                          Cancel booking
                        </Button>
                      </Stack>
                    )}
                    {order.status === "payment_received"
                      && !order.confirmationEmailComplete
                      && bankTransferPermissions.canUpdate && (
                        <Button
                          fullWidth
                          variant="light"
                          leftSection={<IconSend size={18} />}
                          loading={retryingConfirmationOrderId === order.publicId}
                          onClick={() => void retryBankTransferConfirmation(order)}
                        >
                          Retry confirmation
                        </Button>
                      )}
                    {order.status === "cancelled"
                      && !order.bankTransferCancellationEmailSentAt
                      && bankTransferPermissions.canUpdate && (
                        <Button
                          fullWidth
                          variant="light"
                          leftSection={<IconSend size={18} />}
                          loading={resendingCancellationOrderId === order.publicId}
                          onClick={() => void resendBankTransferCancellation(order)}
                        >
                          Retry cancellation email
                        </Button>
                      )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </>
        ) : activeTab === "recovered" && recoveredCarts.length === 0 ? (
          <Box py={80} ta="center">
            <IconShoppingCart size={34} color="var(--mantine-color-gray-5)" />
            <Title order={3} mt="sm">No recovered sales yet</Title>
            <Text c="dimmed">Paid orders attributed to a recovery email will appear here.</Text>
          </Box>
        ) : activeTab === "recovered" ? (
          <Box style={{ overflowX: "auto" }}>
            <Table verticalSpacing="md" horizontalSpacing="md" striped highlightOnHover miw={1280}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Customer</Table.Th>
                  <Table.Th>Experiences</Table.Th>
                  <Table.Th>Total</Table.Th>
                  <Table.Th>Cart started</Table.Th>
                  <Table.Th>Recovery emails</Table.Th>
                  <Table.Th>Link opened</Table.Th>
                  <Table.Th>Sale recovered</Table.Th>
                  <Table.Th>Click to sale</Table.Th>
                  <Table.Th>Order</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {recoveredCarts.map((cart) => (
                  <Table.Tr key={cart.publicId}>
                    <Table.Td>
                      <Text fw={700}>{cart.customer.fullName}</Text>
                      <Text size="xs" c="dimmed">{cart.customer.email}</Text>
                      <Text size="xs" c="dimmed">{customerPhone(cart.customer)}</Text>
                      <Text size="xs" c="dimmed">{customerCountry(cart.customer.phoneCountry)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap="sm">
                        {cart.quote.items.map((item, itemIndex) => (
                          <ExperienceDetails
                            key={`${item.productName}-${item.experienceDate}-${item.experienceTime}-${itemIndex}`}
                            item={item}
                          />
                        ))}
                      </Stack>
                    </Table.Td>
                    <Table.Td fw={700}>{money(cart.total, cart.currency)}</Table.Td>
                    <Table.Td>{recoveryDate(cart.createdAt)}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{cart.recoveryCount} sent</Text>
                      <Text size="xs" c="dimmed">First: {recoveryDate(cart.firstRecoverySentAt)}</Text>
                      {cart.recoveryCount > 1 && <Text size="xs" c="dimmed">Last: {recoveryDate(cart.lastRecoverySentAt)}</Text>}
                    </Table.Td>
                    <Table.Td>{recoveryDate(cart.recoveryOpenedAt)}</Table.Td>
                    <Table.Td>{recoveryDate(cart.recoveredAt)}</Table.Td>
                    <Table.Td>{recoveryDuration(cart.recoveryOpenedAt, cart.recoveredAt)}</Table.Td>
                    <Table.Td>
                      {cart.orderPublicId
                        ? <Text size="sm" fw={600}>{cart.orderPublicId}</Text>
                        : <Text size="sm" c="dimmed">-</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Group justify="flex-end" gap="xs" wrap="nowrap">
                        <Tooltip label="View cart activity">
                          <Button
                            variant="subtle"
                            px="xs"
                            onClick={() => void openCartActivity(cart)}
                            aria-label="View cart activity"
                          >
                            <IconListDetails size={18} />
                          </Button>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        ) : ongoingCarts.length === 0 ? (
          <Box py={80} ta="center">
            <IconShoppingCart size={34} color="var(--mantine-color-gray-5)" />
            <Title order={3} mt="sm">No ongoing carts</Title>
            <Text c="dimmed">Customer carts awaiting payment will appear here.</Text>
          </Box>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <Table verticalSpacing="md" horizontalSpacing="md" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Customer</Table.Th>
                  <Table.Th>Experiences</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Total</Table.Th>
                  <Table.Th>Recovery</Table.Th>
                  <Table.Th>Last activity</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ongoingCarts.map((ongoingCart) => {
                  const recoveryUrl = `${storefrontBaseUrl}/cart?recover=${ongoingCart.publicId}`;
                  return (
                    <Table.Tr key={ongoingCart.publicId}>
                      <Table.Td>
                        <Text fw={700}>{ongoingCart.customer.fullName}</Text>
                        <Text size="xs" c="dimmed">{ongoingCart.customer.email}</Text>
                        <Text size="xs" c="dimmed">{customerPhone(ongoingCart.customer)}</Text>
                        <Text size="xs" c="dimmed">{customerCountry(ongoingCart.customer.phoneCountry)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap="sm">
                          {ongoingCart.quote.items.map((item, itemIndex) => (
                            <ExperienceDetails
                              key={`${item.productName}-${item.experienceDate}-${item.experienceTime}-${itemIndex}`}
                              item={item}
                            />
                          ))}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={ongoingCart.recoveryOpenedAt ? "cyan" : statusColor(ongoingCart.status)} variant="light">
                          {ongoingCart.recoveryOpenedAt
                            ? "Recovery link opened"
                            : ongoingCart.status === "active"
                              ? "Active cart"
                              : statusLabel(ongoingCart.status)}
                        </Badge>
                      </Table.Td>
                      <Table.Td fw={700}>{money(ongoingCart.total, ongoingCart.currency)}</Table.Td>
                      <Table.Td>
                        {ongoingCart.recoveryOpenedAt
                          ? `Opened ${dayjs(ongoingCart.recoveryOpenedAt).format("D MMM, HH:mm:ss")}`
                          : ongoingCart.recoverySentAt
                            ? `Sent ${dayjs(ongoingCart.recoverySentAt).format("D MMM, HH:mm:ss")}`
                            : `Due ${dayjs(ongoingCart.recoveryDueAt).format("D MMM, HH:mm:ss")}`}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{dayjs(ongoingCart.lastActivityAt).format("D MMM, HH:mm:ss")}</Text>
                        {ongoingCart.events?.[0] && (
                          <Text size="xs" c={ongoingCart.events[0].severity === "error" ? "red" : "dimmed"} lineClamp={1} maw={260}>
                            {ongoingCart.events[0].message}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group justify="flex-end" gap="xs" wrap="nowrap">
                          <Tooltip label="View cart activity"><Button variant="subtle" px="xs" onClick={() => void openCartActivity(ongoingCart)} aria-label="View cart activity"><IconListDetails size={18} /></Button></Tooltip>
                          <Tooltip label={ongoingCart.recoveryCount > 0 ? "Preview another recovery email" : "Preview recovery email"}>
                            <Button
                              variant="subtle"
                              px="xs"
                              loading={previewingRecoveryId === ongoingCart.publicId}
                              disabled={ongoingCart.status === "sending_recovery"}
                              onClick={() => void previewRecoveryEmail(ongoingCart)}
                              aria-label="Preview recovery email"
                            >
                              <IconMail size={18} />
                            </Button>
                          </Tooltip>
                          <Tooltip label="Copy recovery link"><Button variant="subtle" px="xs" onClick={() => void copyRecoveryLink(ongoingCart)} aria-label="Copy recovery link"><IconCopy size={18} /></Button></Tooltip>
                          <Tooltip label="Open recovery link"><Button component="a" href={recoveryUrl} target="_blank" rel="noreferrer" variant="subtle" px="xs" aria-label="Open recovery link"><IconExternalLink size={18} /></Button></Tooltip>
                          <Tooltip label="Dismiss cart"><Button color="red" variant="subtle" px="xs" onClick={() => void dismissOngoing(ongoingCart)} aria-label="Dismiss ongoing cart"><IconBan size={18} /></Button></Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Stack>

      <Modal
        opened={Boolean(recoveryEmailPreview)}
        onClose={() => setRecoveryEmailPreview(null)}
        title="Recovery email preview"
        fullScreen
      >
        {recoveryEmailPreview && (
          <Stack h="calc(100vh - 92px)" gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Box>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">Recipient</Text>
                <Text fw={600}>{recoveryEmailPreview.to}</Text>
              </Box>
              <Box>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">Subject</Text>
                <Text fw={600}>{recoveryEmailPreview.subject}</Text>
              </Box>
            </SimpleGrid>
            {error && <Alert color="red" title="Recovery email unavailable">{error}</Alert>}
            <Box style={{ flex: 1, minHeight: 0, border: "1px solid var(--mantine-color-gray-4)" }}>
              <iframe
                title="Recovery email"
                srcDoc={recoveryEmailPreview.htmlBody}
                sandbox=""
                style={{ width: "100%", height: "100%", border: 0, background: "#080708" }}
              />
            </Box>
            <Group justify="flex-end">
              <Button variant="default" disabled={Boolean(sendingRecoveryId)} onClick={() => setRecoveryEmailPreview(null)}>Cancel</Button>
              <Button
                leftSection={<IconSend size={18} />}
                loading={sendingRecoveryId === recoveryEmailPreview.cart.publicId}
                onClick={() => void sendRecoveryEmail(recoveryEmailPreview.cart)}
              >
                Send email
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={Boolean(activityCart)}
        onClose={() => { setActivityCart(null); setActivity(null); }}
        title="Cart activity"
        size="xl"
        centered
      >
        {activityCart && (
          <Stack gap="md">
            <Box>
              <Text fw={700}>{activityCart.customer.fullName}</Text>
              <Text size="sm" c="dimmed">{activityCart.customer.email}</Text>
            </Box>
            <Divider />
            {activityLoading && <Group justify="center" py="xl"><Loader size="sm" /><Text c="dimmed">Loading customer journey</Text></Group>}
            {!activityLoading && activity?.visits.map((visit, visitIndex) => (
              <Paper key={visit.id} withBorder p="md" radius="sm">
                <Group justify="space-between" align="flex-start" mb="md">
                  <Box>
                    <Text fw={700}>Visit {visitIndex + 1}</Text>
                    <Text size="xs" c="dimmed">
                      {visitIndex > 0 && visit.browserInstanceId === activity.visits[visitIndex - 1]?.browserInstanceId
                        ? "Returned from the same browser"
                        : "Storefront visit"}
                    </Text>
                  </Box>
                  <Stack gap={2} align="flex-end">
                    <Text size="xs" c="dimmed">{dayjs(visit.startedAt).format("D MMM YYYY, HH:mm:ss")}</Text>
                    {visit.claritySampled && <Badge size="xs" variant="light">Replay sampled</Badge>}
                  </Stack>
                </Group>
                <Stack gap={0}>
                  {visit.events.map((event, eventIndex) => (
                    <Box
                      key={event.id}
                      py="sm"
                      style={eventIndex < visit.events.length - 1 ? { borderBottom: "1px solid var(--mantine-color-gray-3)" } : undefined}
                    >
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Box>
                          <Text size="sm" fw={600}>{storefrontJourneyEventDescription(event)}</Text>
                          {storefrontJourneyEventSummary(event) && (
                            <Text size="xs" c="dimmed" mt={3}>
                              {storefrontJourneyEventSummary(event)}
                            </Text>
                          )}
                          <Group gap="xs" mt={4}>
                            <Badge size="xs" color={event.severity === "error" ? "red" : event.severity === "warning" ? "yellow" : "blue"} variant="light">
                              {event.source}
                            </Badge>
                            <Text size="xs" c="dimmed">{event.type.replaceAll("_", " ")}</Text>
                          </Group>
                        </Box>
                        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{dayjs(event.occurredAt).format("HH:mm:ss")}</Text>
                      </Group>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            ))}
            {!activityLoading && activity && activity.visits.length === 0 && activity.legacyEvents.length === 0 && (
              <Text c="dimmed">No customer journey has been recorded for this cart yet.</Text>
            )}
            {!activityLoading && activity?.legacyEvents.map((event) => (
              <Box key={event.id} p="sm" style={{ border: "1px solid var(--mantine-color-gray-3)" }}>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Box>
                    <Text size="sm" fw={600}>{event.message}</Text>
                    <Badge mt={4} size="xs" variant="light" color={event.severity === "error" ? "red" : "yellow"}>Earlier event</Badge>
                  </Box>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{dayjs(event.occurredAt).format("HH:mm:ss")}</Text>
                </Group>
              </Box>
            ))}
          </Stack>
        )}
      </Modal>

      <Modal
        opened={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        title={creatorMode === "bank-transfer" ? "Create bank transfer booking" : "Create payment link"}
        size="xl"
        centered
        fullScreen={isMobile}
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
      >
        <Stack gap="lg">
          {creatorMode === "bank-transfer" ? (
            <>
              <Alert color="blue" icon={<IconBuildingBank size={18} />}>
                The booking is reserved immediately. The customer receives the booking summary and bank transfer instructions by email.
              </Alert>
              {bankTransferCatalogLoading && (
                <Group justify="center" gap="sm">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Loading available experiences...</Text>
                </Group>
              )}
              {bankTransferCatalogError && (
                <Alert color="red" title="Experience catalog unavailable">
                  <Stack gap="sm" align="flex-start">
                    <Text size="sm">{bankTransferCatalogError}</Text>
                    <Button variant="light" color="red" size="xs" onClick={() => void loadBankTransferCatalog()}>
                      Try again
                    </Button>
                  </Stack>
                </Alert>
              )}
            </>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Internal name" placeholder="Customer or group name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
              <NumberInput label="Expires after" suffix=" days" min={1} max={90} value={expiresInDays} onChange={setExpiresInDays} />
            </SimpleGrid>
          )}

          <Divider label="Experiences" labelPosition="center" />
          {items.map((item, itemIndex) => {
            const product = item.productId ? productById.get(item.productId) : null;
            const participantCount = product?.config.participantMode === "gender_split" ? item.men + item.women : item.quantity;
            return (
              <Paper key={item.key} withBorder p="md" radius="sm">
                <Stack gap="md">
                  <Group justify="space-between">
                    <Text fw={700}>Experience {itemIndex + 1}</Text>
                    {items.length > 1 && <Tooltip label="Remove experience"><Button color="red" variant="subtle" px="xs" onClick={() => { setItems((current) => current.filter((candidate) => candidate.key !== item.key)); setQuote(null); }} aria-label="Remove experience"><IconTrash size={18} /></Button></Tooltip>}
                  </Group>
                  <Select
                    label="Product"
                    searchable
                    data={creatorProducts.map((candidate) => ({ value: String(candidate.id), label: candidate.name }))}
                    value={item.productId ? String(item.productId) : null}
                    onChange={(value) => selectProduct(item, value)}
                  />
                  {product && (
                    <>
                      <SimpleGrid cols={{ base: 1, sm: 3 }}>
                        <TextInput label="Date" type="date" min={dayjs().format("YYYY-MM-DD")} value={item.experienceDate} onChange={(event) => updateItem(item.key, { experienceDate: event.currentTarget.value })} required={product.config.dateRequired} />
                        {product.config.timeMode === "select" ? (
                          <Select label="Start time" data={(product.config.startTimes || []).map((time) => ({ value: time, label: time }))} value={item.experienceTime || null} onChange={(value) => updateItem(item.key, { experienceTime: value || "" })} />
                        ) : (
                          <TextInput label="Start time" type="time" disabled={product.config.timeMode === "fixed"} value={item.experienceTime} onChange={(event) => updateItem(item.key, { experienceTime: event.currentTarget.value })} />
                        )}
                        {product.config.participantMode === "gender_split" ? (
                          <Group grow align="flex-end">
                            <NumberInput label="Men" min={0} max={product.config.maxParticipants || 50} value={item.men} onChange={(value) => updateItem(item.key, { men: Number(value) || 0 })} />
                            <NumberInput label="Women" min={0} max={product.config.maxParticipants || 50} value={item.women} onChange={(value) => updateItem(item.key, { women: Number(value) || 0 })} />
                          </Group>
                        ) : (
                          <NumberInput label="Guests" min={product.config.minParticipants || 1} max={product.config.maxParticipants || 50} value={item.quantity} onChange={(value) => updateItem(item.key, { quantity: Number(value) || 1 })} />
                        )}
                      </SimpleGrid>

                      {product.addons.length > 0 && (
                        <Stack gap="sm">
                          <Text size="sm" fw={700}>Add-ons</Text>
                          {product.addons.map((addon) => {
                            const draft = item.addons[addon.id] || { enabled: false, quantity: 0, value: "", variants: {} };
                            const mode = addon.config.selectionMode || "boolean";
                            const cap = addonCap(addon, participantCount);
                            const allowed = (addon.config.allowedQuantities || []).filter((quantity) => quantity <= cap);
                            const activeQuantity = Math.max(1, draft.quantity || Number(addon.config.minQuantity || 1));
                            return (
                              <Box key={addon.id} py="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
                                <Group justify="space-between" align="flex-end" wrap="wrap">
                                  <Box>
                                    <Text fw={600}>{addon.name}</Text>
                                    <Text size="xs" c="dimmed">{addon.price ? money(addon.price.amount, addon.price.currency) : "Included"}</Text>
                                  </Box>
                                  {mode === "options" ? (
                                    <Select w={220} placeholder="None" clearable data={(addon.config.options || []).map((option) => ({ value: option.value, label: option.label }))} value={draft.value || null} onChange={(value) => updateAddon(item, addon.id, { value: value || "", enabled: Boolean(value), quantity: value ? 1 : 0 })} />
                                  ) : mode === "boolean" ? (
                                    <Switch label={draft.enabled ? "Added" : "None"} checked={draft.enabled} onChange={(event) => updateAddon(item, addon.id, { enabled: event.currentTarget.checked, quantity: event.currentTarget.checked ? 1 : 0 })} />
                                  ) : allowed.length > 0 ? (
                                    <Select w={150} label="Quantity" data={[{ value: "0", label: "None" }, ...allowed.map((quantity) => ({ value: String(quantity), label: String(quantity) }))]} value={String(draft.enabled ? draft.quantity : 0)} onChange={(value) => updateAddon(item, addon.id, { enabled: Number(value) > 0, quantity: Number(value) || 0 })} />
                                  ) : (
                                    <NumberInput w={150} label="Quantity" min={0} max={cap} value={draft.enabled ? draft.quantity : 0} onChange={(value) => updateAddon(item, addon.id, { enabled: Number(value) > 0, quantity: Number(value) || 0 })} />
                                  )}
                                </Group>
                                {addon.inventory.variantSelectionRequired && draft.enabled && (
                                  <SimpleGrid cols={{ base: 2, sm: 4 }} mt="sm">
                                    {addon.inventory.variants.map((variant) => (
                                      <NumberInput
                                        key={variant.value}
                                        label={variant.label}
                                        min={0}
                                        max={activeQuantity}
                                        value={draft.variants[variant.value] || 0}
                                        onChange={(value) => updateAddon(item, addon.id, { variants: { ...draft.variants, [variant.value]: Number(value) || 0 } })}
                                      />
                                    ))}
                                  </SimpleGrid>
                                )}
                              </Box>
                            );
                          })}
                        </Stack>
                      )}
                    </>
                  )}
                </Stack>
              </Paper>
            );
          })}
          <Button variant="default" leftSection={<IconPlus size={17} />} onClick={() => { setItems((current) => [...current, emptyItem()]); setQuote(null); }}>Add experience</Button>

          <Divider label="Customer and pricing" labelPosition="center" />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Full name"
              description={creatorMode === "payment-link" ? "Optional prefill" : undefined}
              required={creatorMode === "bank-transfer"}
              value={customer.fullName}
              onChange={(event) => setCustomer((current) => ({ ...current, fullName: event.currentTarget.value }))}
            />
            <TextInput
              label="Email"
              description={creatorMode === "payment-link" ? "Optional prefill" : undefined}
              required={creatorMode === "bank-transfer"}
              type="email"
              value={customer.email}
              onChange={(event) => setCustomer((current) => ({ ...current, email: event.currentTarget.value }))}
            />
            <Select
              label="Country code"
              description={creatorMode === "payment-link" ? "Optional prefill" : undefined}
              searchable
              clearable
              data={countryOptions}
              value={customer.phoneCountry || null}
              onChange={(value) => setCustomer((current) => ({ ...current, phoneCountry: value || "" }))}
            />
            <TextInput
              label="Phone"
              description={creatorMode === "payment-link" ? "Optional prefill" : undefined}
              value={customer.phone}
              onChange={(event) => setCustomer((current) => ({ ...current, phone: event.currentTarget.value }))}
            />
          </SimpleGrid>
          <TextInput label="Discount codes" description="Separate multiple codes with commas" value={discountCodes} onChange={(event) => { setDiscountCodes(event.currentTarget.value); setQuote(null); }} />

          {quote && (
            <Box py="sm" style={{ borderTop: "1px solid var(--mantine-color-gray-3)", borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
              <Group justify="space-between"><Text>Experiences</Text><Text fw={600}>{money(quote.subtotal, quote.currency)}</Text></Group>
              <Group justify="space-between"><Text>Add-ons</Text><Text fw={600}>{money(quote.addonTotal, quote.currency)}</Text></Group>
              {quote.discountTotal > 0 && <Group justify="space-between"><Text>Discount</Text><Text fw={600}>-{money(quote.discountTotal, quote.currency)}</Text></Group>}
              <Group justify="space-between" mt="sm"><Text size="lg" fw={700}>Customer pays</Text><Text size="xl" fw={700}>{money(quote.total, quote.currency)}</Text></Group>
            </Box>
          )}
          {formError && <Alert color="red">{formError}</Alert>}
          <Group
            justify="flex-end"
            style={isMobile ? {
              position: "sticky",
              bottom: 0,
              zIndex: 2,
              paddingTop: 12,
              paddingBottom: 4,
              background: "var(--mantine-color-body)",
            } : undefined}
          >
            <Button variant="default" disabled={saving} onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              variant="light"
              loading={previewing}
              disabled={saving || (creatorMode === "bank-transfer"
                ? bankTransferCatalogLoading || Boolean(bankTransferCatalogError)
                : paymentLinkCatalogLoading || Boolean(paymentLinkCatalogError))}
              onClick={() => void preview()}
            >
              Review total
            </Button>
            <Button
              leftSection={creatorMode === "bank-transfer"
                ? <IconBuildingBank size={17} />
                : <IconLink size={17} />}
              loading={saving}
              disabled={creatorMode === "bank-transfer"
                ? bankTransferCatalogLoading || Boolean(bankTransferCatalogError)
                : paymentLinkCatalogLoading || Boolean(paymentLinkCatalogError)}
              onClick={() => void create()}
            >
              {creatorMode === "bank-transfer" ? "Create booking & send email" : "Create and copy link"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(receivingOrder)}
        onClose={closePaymentReceived}
        title="Confirm payment received"
        size="md"
        centered
        fullScreen={isMobile}
        closeOnClickOutside={!paymentReceivedSaving}
        closeOnEscape={!paymentReceivedSaving}
      >
        {receivingOrder && (
          <Stack gap="lg">
            <Paper withBorder radius="md" p="lg" ta="center">
              <Badge color="orange" variant="light" mb="sm">Awaiting transfer</Badge>
              <Text fw={700}>{receivingOrder.customer.fullName}</Text>
              <Text size="xs" c="dimmed">Order {shortOrderReference(receivingOrder.publicId)}</Text>
              <Text size="xl" fw={800} mt="md">
                {money(receivingOrder.total, receivingOrder.currency)}
              </Text>
              {receivingOrder.paymentReference && (
                <Text size="sm" fw={600} mt="xs">
                  Transfer reference: {receivingOrder.paymentReference}
                </Text>
              )}
            </Paper>

            <Alert color="blue" icon={<IconCircleCheck size={18} />}>
              Confirm only after the transfer is visible in the bank account. The booking will be marked paid and the customer confirmation will be sent.
            </Alert>

            <TextInput
              label="Payment reference"
              description="Optional"
              placeholder="Bank statement or transfer reference"
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.currentTarget.value)}
            />
            <Textarea
              label="Internal note"
              description="Optional"
              minRows={3}
              autosize
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.currentTarget.value)}
            />

            {paymentReceivedError && <Alert color="red">{paymentReceivedError}</Alert>}

            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={closePaymentReceived} disabled={paymentReceivedSaving}>
                Cancel
              </Button>
              <Button
                color="green"
                leftSection={<IconCircleCheck size={18} />}
                loading={paymentReceivedSaving}
                onClick={() => void markPaymentReceived()}
              >
                Confirm payment received
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={Boolean(cancellingOrder)}
        onClose={closeBankTransferCancellation}
        title="Cancel bank transfer booking"
        size="md"
        centered
        fullScreen={isMobile}
        closeOnClickOutside={!cancellationSaving}
        closeOnEscape={!cancellationSaving}
      >
        {cancellingOrder && (
          <Stack gap="lg">
            <Paper withBorder radius="md" p="lg" ta="center">
              <Badge color="orange" variant="light" mb="sm">Awaiting transfer</Badge>
              <Text fw={700}>{cancellingOrder.customer.fullName}</Text>
              <Text size="xs" c="dimmed">Order {shortOrderReference(cancellingOrder.publicId)}</Text>
              <Text size="xl" fw={800} mt="md">
                {money(cancellingOrder.total, cancellingOrder.currency)}
              </Text>
              {cancellingOrder.paymentReference && (
                <Text size="sm" fw={600} mt="xs">
                  Transfer reference: {cancellingOrder.paymentReference}
                </Text>
              )}
            </Paper>

            <Alert color="red" icon={<IconBan size={18} />} title="Cancel this unpaid reservation?">
              Its reserved bookings will be cancelled and removed from the active bank-transfer queue. No Stripe refund is created. The customer will receive a cancellation email.
            </Alert>

            <Textarea
              label="Internal cancellation note"
              description="Optional — saved in the audit record and not included in the customer email"
              minRows={3}
              autosize
              value={cancellationNote}
              onChange={(event) => setCancellationNote(event.currentTarget.value)}
            />

            {cancellationError && <Alert color="red">{cancellationError}</Alert>}

            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={closeBankTransferCancellation} disabled={cancellationSaving}>
                Keep booking
              </Button>
              <Button
                color="red"
                leftSection={<IconBan size={18} />}
                loading={cancellationSaving}
                onClick={() => void cancelBankTransferReservation()}
              >
                Cancel booking
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageAccessGuard>
  );
};

export default PaymentLinksPage;
