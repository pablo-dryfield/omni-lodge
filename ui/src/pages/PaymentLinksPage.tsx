import { useEffect, useMemo, useState } from "react";
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
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconBan,
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
import { PAGE_SLUGS } from "../constants/pageSlugs";

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

type StorefrontCartTab = "prepared" | "ongoing" | "recovered";

const storefrontCartTabs = new Set<StorefrontCartTab>(["prepared", "ongoing", "recovered"]);

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

const customerPhone = (customer: OngoingCart["customer"]): string => {
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

const errorMessage = (error: unknown): string => {
  const payload = error as { response?: { data?: { message?: string; error?: { message?: string } } }; message?: string };
  return payload.response?.data?.message || payload.response?.data?.error?.message || payload.message || "Request failed.";
};

const eventValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const journeyEventDescription = (event: JourneyEvent): string => {
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
    experience_date_changed: `Activity date changed from ${previous} to ${next}`,
    experience_time_changed: `Start time changed from ${previous} to ${next}`,
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
    payment_error: eventValue(details.message || "Payment error"),
    payment_authentication_cancelled: "Payment authentication cancelled",
    checkout_page_hidden: "Checkout left or moved to the background",
    checkout_page_resumed: "Checkout resumed",
    recovery_email_opened: "Recovery email link opened",
  };
  return descriptions[event.type]
    || eventValue(details.message)
    || event.type.replaceAll("_", " ");
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
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [links, setLinks] = useState<SavedCart[]>([]);
  const [ongoingCarts, setOngoingCarts] = useState<OngoingCart[]>([]);
  const [recoveredCarts, setRecoveredCarts] = useState<OngoingCart[]>([]);
  const [sendingRecoveryId, setSendingRecoveryId] = useState<string | null>(null);
  const [previewingRecoveryId, setPreviewingRecoveryId] = useState<string | null>(null);
  const [recoveryEmailPreview, setRecoveryEmailPreview] = useState<RecoveryEmailPreview | null>(null);
  const [activityCart, setActivityCart] = useState<OngoingCart | null>(null);
  const [activity, setActivity] = useState<CartActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const activeTab = storefrontCartTab(searchParams.get("tab"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [formError, setFormError] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | string>(7);
  const [discountCodes, setDiscountCodes] = useState("");
  const [customer, setCustomer] = useState({ fullName: "", email: "", phoneCountry: "", phone: "" });
  const [items, setItems] = useState<CartItemDraft[]>([emptyItem()]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogResponse, linksResponse, ongoingResponse, recoveredResponse] = await Promise.all([
        axiosInstance.get<{ products: StorefrontProduct[] }>("/storefront/products"),
        axiosInstance.get<{ data: SavedCart[] }>("/storefront-saved-carts"),
        axiosInstance.get<{ data: OngoingCart[] }>("/storefront-ongoing-carts"),
        axiosInstance.get<{ data: OngoingCart[] }>("/storefront-ongoing-carts/recovered"),
      ]);
      setProducts(catalogResponse.data.products || []);
      setLinks(linksResponse.data.data || []);
      setOngoingCarts(ongoingResponse.data.data || []);
      setRecoveredCarts(recoveredResponse.data.data || []);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (searchParams.get("tab") === activeTab) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", activeTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  const changeTab = (value: string | null) => {
    if (!value || !storefrontCartTabs.has(value as StorefrontCartTab)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", value);
    setSearchParams(nextParams, { replace: false });
  };

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const resetForm = () => {
    setName("");
    setExpiresInDays(7);
    setDiscountCodes("");
    setCustomer({ fullName: "", email: "", phoneCountry: "", phone: "" });
    setItems([emptyItem()]);
    setQuote(null);
    setFormError("");
  };

  const openCreator = () => {
    resetForm();
    setModalOpen(true);
  };

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

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>
      <Stack gap="lg" p={{ base: "md", md: "xl" }}>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Box>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">Bookings</Text>
            <Title order={1} size="h2">Storefront carts</Title>
            <Text c="dimmed">Manage prepared links, ongoing carts, and sales recovered by email.</Text>
          </Box>
          <Group>
            <Tooltip label="Refresh statuses">
              <Button variant="default" px="sm" onClick={() => void load()} aria-label="Refresh payment links">
                <IconRefresh size={18} />
              </Button>
            </Tooltip>
            {activeTab === "prepared" && <Button leftSection={<IconPlus size={18} />} onClick={openCreator}>New payment link</Button>}
          </Group>
        </Group>

        <Group gap="xs">
          <Button variant="subtle" onClick={() => navigate("/bookings")}>Calendar</Button>
          <Button variant="light" leftSection={<IconLink size={17} />}>Payment links</Button>
        </Group>

        <Tabs value={activeTab} onChange={changeTab}>
          <Tabs.List>
            <Tabs.Tab value="prepared" leftSection={<IconLink size={16} />}>Prepared links</Tabs.Tab>
            <Tabs.Tab value="ongoing" leftSection={<IconShoppingCart size={16} />}>Ongoing carts</Tabs.Tab>
            <Tabs.Tab value="recovered" leftSection={<IconShoppingCart size={16} />}>Recovered sales</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {error && <Alert color="red" title="Payment links unavailable">{error}</Alert>}

        {loading ? (
          <Box mih={260} style={{ display: "grid", placeItems: "center" }}><Loader /></Box>
        ) : activeTab === "prepared" && links.length === 0 ? (
          <Box py={80} ta="center">
            <IconLink size={34} color="var(--mantine-color-gray-5)" />
            <Title order={3} mt="sm">No payment links yet</Title>
            <Text c="dimmed" mb="lg">Create a prepared booking when a customer is ready to pay.</Text>
            <Button leftSection={<IconPlus size={18} />} onClick={openCreator}>New payment link</Button>
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
                          <Text size="sm" fw={600}>{journeyEventDescription(event)}</Text>
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

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Create payment link" size="xl" centered>
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Internal name" placeholder="Customer or group name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
            <NumberInput label="Expires after" suffix=" days" min={1} max={90} value={expiresInDays} onChange={setExpiresInDays} />
          </SimpleGrid>

          <Divider label="Experiences" labelPosition="center" />
          {items.map((item, itemIndex) => {
            const product = item.productId ? productById.get(item.productId) : null;
            const participantCount = product?.config.participantMode === "gender_split" ? item.men + item.women : item.quantity;
            return (
              <Paper key={item.key} withBorder p="md" radius="sm">
                <Stack gap="md">
                  <Group justify="space-between">
                    <Text fw={700}>Experience {itemIndex + 1}</Text>
                    {items.length > 1 && <Tooltip label="Remove experience"><Button color="red" variant="subtle" px="xs" onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))} aria-label="Remove experience"><IconTrash size={18} /></Button></Tooltip>}
                  </Group>
                  <Select
                    label="Product"
                    searchable
                    data={products.map((candidate) => ({ value: String(candidate.id), label: candidate.name }))}
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
          <Button variant="default" leftSection={<IconPlus size={17} />} onClick={() => setItems((current) => [...current, emptyItem()])}>Add experience</Button>

          <Divider label="Customer and pricing" labelPosition="center" />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Full name" description="Optional prefill" value={customer.fullName} onChange={(event) => setCustomer((current) => ({ ...current, fullName: event.currentTarget.value }))} />
            <TextInput label="Email" description="Optional prefill" type="email" value={customer.email} onChange={(event) => setCustomer((current) => ({ ...current, email: event.currentTarget.value }))} />
            <Select label="Country code" description="Optional prefill" searchable clearable data={countryOptions} value={customer.phoneCountry || null} onChange={(value) => setCustomer((current) => ({ ...current, phoneCountry: value || "" }))} />
            <TextInput label="Phone" description="Optional prefill" value={customer.phone} onChange={(event) => setCustomer((current) => ({ ...current, phone: event.currentTarget.value }))} />
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
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="light" loading={previewing} onClick={() => void preview()}>Review total</Button>
            <Button leftSection={<IconLink size={17} />} loading={saving} onClick={() => void create()}>Create and copy link</Button>
          </Group>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default PaymentLinksPage;
