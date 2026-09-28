import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Code,
  Divider,
  Grid,
  Group,
  JsonInput,
  Loader,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconBraces,
  IconCheck,
  IconEdit,
  IconEye,
  IconFile,
  IconHistory,
  IconMapPin,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTemplate,
  IconTrash,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  archiveWhatsAppTemplates,
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  fetchWhatsAppTemplateEvents,
  fetchWhatsAppTemplates,
  fetchWhatsAppTemplateVariables,
  previewWhatsAppTemplate,
  searchWhatsAppTemplateBookings,
  sendManagedWhatsAppTemplate,
  syncWhatsAppTemplates,
  unarchiveWhatsAppTemplates,
  unpauseWhatsAppTemplate,
  updateWhatsAppTemplate,
  WHATSAPP_TEMPLATES_QUERY_KEY,
  WHATSAPP_TEMPLATE_VARIABLES_QUERY_KEY,
  type WhatsAppManagedTemplate,
  type WhatsAppTemplateBooking,
  type WhatsAppTemplateBookingBindings,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateComponent,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateParameterFormat,
  type WhatsAppTemplatePreview,
  type WhatsAppTemplateVariable,
} from "../../api/whatsappTemplates";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import classes from "./SettingsWhatsAppTemplates.module.css";

type SimpleButton = {
  type: "URL" | "PHONE_NUMBER" | "QUICK_REPLY";
  text: string;
  value: string;
  variableKey: string;
};

type BuilderState = {
  editingId: string | null;
  editingStatus: string | null;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  parameterFormat: WhatsAppTemplateParameterFormat;
  ttl: number | string;
  headerText: string;
  body: string;
  footer: string;
  buttons: SimpleButton[];
  componentsJson: string;
  bookingBindings: WhatsAppTemplateBookingBindings;
  bindingSourceComponents: WhatsAppTemplateComponent[];
  editorMode: "visual" | "json";
};

type ProtectedAction =
  | { kind: "sync" }
  | { kind: "archive" | "unarchive" | "unpause"; template: WhatsAppManagedTemplate }
  | { kind: "delete"; template: WhatsAppManagedTemplate };

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "teal",
  PENDING: "blue",
  IN_APPEAL: "violet",
  REJECTED: "red",
  PAUSED: "orange",
  DISABLED: "red",
  ARCHIVED: "gray",
  PENDING_DELETION: "yellow",
  DELETED: "dark",
  LIMIT_EXCEEDED: "pink",
};

const QUALITY_COLORS: Record<string, string> = {
  GREEN: "teal",
  YELLOW: "yellow",
  RED: "red",
  UNKNOWN: "gray",
};

const CATEGORY_OPTIONS = ["UTILITY", "MARKETING", "AUTHENTICATION"].map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

const createAuthenticationComponents = (): WhatsAppTemplateComponent[] => ([
  { type: "BODY", add_security_recommendation: true },
  { type: "FOOTER", code_expiration_minutes: 10 },
  {
    type: "BUTTONS",
    buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }],
  },
]);

const createEmptyBuilder = (): BuilderState => ({
  editingId: null,
  editingStatus: null,
  name: "",
  language: "en_US",
  category: "UTILITY",
  parameterFormat: "NAMED",
  ttl: "",
  headerText: "",
  body: "",
  footer: "",
  buttons: [],
  componentsJson: JSON.stringify([{ type: "BODY", text: "" }], null, 2),
  bookingBindings: {},
  bindingSourceComponents: [{ type: "BODY", text: "" }],
  editorMode: "visual",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string => typeof value === "string" ? value : "";

const componentType = (component: WhatsAppTemplateComponent): string =>
  stringValue(component.type).toUpperCase();

const simpleComponentsFrom = (
  components: WhatsAppTemplateComponent[],
  bookingBindings: WhatsAppTemplateBookingBindings = {},
) => {
  const header = components.find((component) => componentType(component) === "HEADER");
  const body = components.find((component) => componentType(component) === "BODY");
  const footer = components.find((component) => componentType(component) === "FOOTER");
  const buttonComponent = components.find((component) => componentType(component) === "BUTTONS");
  const rawButtons = buttonComponent?.buttons;
  const buttons = Array.isArray(rawButtons)
    ? rawButtons.flatMap((value, index): SimpleButton[] => {
        if (!isRecord(value)) return [];
        const type = stringValue(value.type).toUpperCase();
        if (type !== "URL" && type !== "PHONE_NUMBER" && type !== "QUICK_REPLY") return [];
        return [{
          type,
          text: stringValue(value.text),
          value: type === "URL"
            ? stringValue(value.url)
            : type === "PHONE_NUMBER"
              ? stringValue(value.phone_number ?? value.phoneNumber)
              : "",
          variableKey: bookingBindings.buttons?.[String(index)]?.[0] ?? "",
        }];
      })
    : [];
  return {
    headerText: header && stringValue(header.format).toUpperCase() === "TEXT" ? stringValue(header.text) : "",
    body: stringValue(body?.text),
    footer: stringValue(footer?.text),
    buttons,
  };
};

const hasAdvancedComponents = (components: WhatsAppTemplateComponent[]): boolean =>
  components.some((component) => {
    const type = componentType(component);
    if (!["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(type)) return true;
    if (type === "HEADER" && stringValue(component.format).toUpperCase() !== "TEXT") return true;
    if (type === "BUTTONS" && Array.isArray(component.buttons)) {
      return component.buttons.some((button) => {
        if (!isRecord(button)) return true;
        return !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(stringValue(button.type).toUpperCase());
      });
    }
    return false;
  });

const builderFromTemplate = (template: WhatsAppManagedTemplate): BuilderState => {
  const bookingBindings = template.bookingBindings ?? {};
  const simple = simpleComponentsFrom(template.components, bookingBindings);
  return {
    editingId: template.metaTemplateId,
    editingStatus: template.status,
    name: template.name,
    language: template.language,
    category: (["UTILITY", "MARKETING", "AUTHENTICATION"].includes(template.category)
      ? template.category
      : "UTILITY") as WhatsAppTemplateCategory,
    parameterFormat: template.parameterFormat === "NAMED" ? "NAMED" : "POSITIONAL",
    ttl: template.messageSendTtlSeconds ?? "",
    ...simple,
    componentsJson: JSON.stringify(template.components, null, 2),
    bookingBindings,
    bindingSourceComponents: template.components,
    editorMode: template.category === "AUTHENTICATION" || hasAdvancedComponents(template.components)
      ? "json"
      : "visual",
  };
};

const visualComponents = (builder: BuilderState): WhatsAppTemplateComponent[] => {
  const components: WhatsAppTemplateComponent[] = [];
  if (builder.headerText.trim()) {
    components.push({ type: "HEADER", format: "TEXT", text: builder.headerText.trim() });
  }
  components.push({ type: "BODY", text: builder.body.trim() });
  if (builder.footer.trim()) components.push({ type: "FOOTER", text: builder.footer.trim() });
  if (builder.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: builder.buttons.map((button) => ({
        type: button.type,
        text: button.text.trim(),
        ...(button.type === "URL" ? { url: button.value.trim() } : {}),
        ...(button.type === "PHONE_NUMBER" ? { phone_number: button.value.trim() } : {}),
      })),
    });
  }
  return components;
};

const buttonRecords = (components: WhatsAppTemplateComponent[]): unknown[] => {
  const buttons = components.find((component) => componentType(component) === "BUTTONS")?.buttons;
  return Array.isArray(buttons) ? buttons : [];
};

const dynamicUrlIdentity = (value: unknown): string | null => {
  if (!isRecord(value) || stringValue(value.type).toUpperCase() !== "URL") return null;
  const url = stringValue(value.url);
  if (!url.includes("{{1}}")) return null;
  return JSON.stringify({ type: "URL", text: stringValue(value.text), url });
};

const reconciledBookingBindings = (
  sourceComponents: WhatsAppTemplateComponent[],
  nextComponents: WhatsAppTemplateComponent[],
  current: WhatsAppTemplateBookingBindings,
): WhatsAppTemplateBookingBindings => {
  const sourceButtons = buttonRecords(sourceComponents);
  const nextButtons = buttonRecords(nextComponents);
  const buttons: Record<string, string[]> = {};
  for (const [rawIndex, keys] of Object.entries(current.buttons ?? {})) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || keys.length !== 1) continue;
    const sourceIdentity = dynamicUrlIdentity(sourceButtons[index]);
    const nextIdentity = dynamicUrlIdentity(nextButtons[index]);
    if (!sourceIdentity || sourceIdentity !== nextIdentity) continue;
    // Identical duplicate buttons cannot be mapped safely by index after a JSON reorder.
    if (sourceButtons.filter((button) => dynamicUrlIdentity(button) === sourceIdentity).length !== 1
      || nextButtons.filter((button) => dynamicUrlIdentity(button) === nextIdentity).length !== 1) continue;
    buttons[rawIndex] = keys;
  }
  return Object.keys(buttons).length > 0 ? { buttons } : {};
};

const definitionFromBuilder = (builder: BuilderState): WhatsAppTemplateDefinition => {
  let components: WhatsAppTemplateComponent[];
  if (builder.editorMode === "json") {
    const parsed = JSON.parse(builder.componentsJson) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Components JSON must contain an array.");
    components = parsed.map((component) => {
      if (!isRecord(component)) throw new Error("Every component must be a JSON object.");
      return component;
    });
  } else {
    components = visualComponents(builder);
  }
  const visualButtonBindings = Object.fromEntries(builder.buttons.flatMap((button, index) => (
    button.type === "URL" && button.value.includes("{{1}}") && button.variableKey
      ? [[String(index), [button.variableKey]]]
      : []
  )));
  return {
    name: builder.name.trim(),
    language: builder.language.trim(),
    category: builder.category,
    parameterFormat: builder.parameterFormat,
    messageSendTtlSeconds: builder.ttl === "" ? null : Number(builder.ttl),
    components,
    bookingBindings: builder.editorMode === "visual"
      ? (Object.keys(visualButtonBindings).length > 0 ? { buttons: visualButtonBindings } : {})
      : reconciledBookingBindings(
          builder.bindingSourceComponents,
          components,
          builder.bookingBindings,
        ),
  };
};

const responseEntries = (response: unknown): Record<string, unknown>[] => {
  if (Array.isArray(response)) return response.filter(isRecord);
  return isRecord(response) ? [response] : [];
};

const extractErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof response === "string" && response.trim()) return response;
  for (const entry of responseEntries(response)) {
    const details = isRecord(entry.details) ? entry.details : null;
    const ambiguous = details?.ambiguous === true;
    for (const key of ["message", "error", "detail"]) {
      const candidate = entry[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return ambiguous
          ? `${candidate} Do not retry this operation yet; Meta may already have applied it. Synchronize templates and check Meta first.`
          : candidate;
      }
    }
  }
  return error instanceof Error ? error.message : "The WhatsApp template operation failed.";
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const titleCase = (value: string): string =>
  value.toLowerCase().replace(/(^|_)([a-z])/g, (_match, space: string, letter: string) =>
    `${space ? " " : ""}${letter.toUpperCase()}`);

const validateDefinition = (definition: WhatsAppTemplateDefinition): string | null => {
  if (!/^[a-z0-9_]{1,512}$/.test(definition.name)) {
    return "Use only lowercase letters, numbers, and underscores for the template name.";
  }
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(definition.language)) {
    return "Enter a language such as en_US or pl_PL.";
  }
  if (!Number.isInteger(definition.messageSendTtlSeconds) && definition.messageSendTtlSeconds !== null) {
    return "The message TTL must be a whole number of seconds.";
  }
  const bodies = definition.components.filter((component) => componentType(component) === "BODY");
  const body = bodies[0];
  if (definition.category === "AUTHENTICATION") {
    const validAuthenticationBody = bodies.length === 1
      && body.text === undefined
      && (body.add_security_recommendation === undefined
        || typeof body.add_security_recommendation === "boolean");
    if (!validAuthenticationBody) {
      return "Authentication template bodies use Meta preset text and cannot define custom text.";
    }
    const footers = definition.components.filter((component) => componentType(component) === "FOOTER");
    const footer = footers[0];
    const expiration = footer?.code_expiration_minutes;
    if (footers.length > 1 || (footer !== undefined && (
      footer.text !== undefined
      || !Number.isInteger(expiration)
      || Number(expiration) < 1
      || Number(expiration) > 90
    ))) {
      return "Authentication template footers require a code expiration between 1 and 90 minutes.";
    }
  } else if (bodies.length !== 1 || !stringValue(body.text).trim()) {
    return "The template needs exactly one non-empty body component.";
  }
  return null;
};

const bookingSendBlockReason = (template: WhatsAppManagedTemplate | null): string | null => {
  if (!template) return "Select a template first.";
  if (typeof template.bookingSendSupported === "boolean") {
    return template.bookingSendSupported
      ? null
      : template.bookingSupportReason ?? "This template cannot be resolved and sent safely with booking data.";
  }
  return legacyBookingSendBlockReason(template);
};

const isSynchronizedTemplate = (template: WhatsAppManagedTemplate): boolean =>
  !template.localState || template.localState === "synced";

const canEditTemplate = (template: WhatsAppManagedTemplate): boolean =>
  isSynchronizedTemplate(template)
  && ["APPROVED", "REJECTED", "PAUSED"].includes(template.status);

// Keep a client-side explanation for older cached API responses during a rolling deployment.
const legacyBookingSendBlockReason = (template: WhatsAppManagedTemplate): string | null => {
  if (template.parameterFormat !== "NAMED") {
    return "Booking sends currently require named parameters so every value has a stable booking-field mapping.";
  }
  for (const component of template.components) {
    const type = componentType(component);
    if (type === "HEADER" && stringValue(component.format).toUpperCase() !== "TEXT") {
      return "Booking sends for media or location headers are not enabled yet.";
    }
    if (!["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(type)) {
      return `Booking sends for ${titleCase(type || "unknown")} components are not enabled yet.`;
    }
    if (type === "BUTTONS") {
      const buttons = component.buttons;
      if (!Array.isArray(buttons)) return "This template's buttons cannot be resolved safely.";
      for (const button of buttons) {
        if (!isRecord(button)) return "This template's buttons cannot be resolved safely.";
        const buttonType = stringValue(button.type).toUpperCase();
        if (buttonType !== "URL" && buttonType !== "PHONE_NUMBER") {
          return `Booking sends for ${titleCase(buttonType || "unknown")} buttons are not enabled yet.`;
        }
      }
    }
  }
  return null;
};

const PreviewPhone = ({ preview }: { preview: WhatsAppTemplatePreview }) => (
  <Box className={classes.phone} aria-label="Approximate WhatsApp message preview">
    <Box className={classes.bubble}>
      {preview.header && preview.header.format !== "TEXT" ? (
        <Box className={classes.mediaPlaceholder}>
          <Stack align="center" gap={4}>
            {preview.header.format === "IMAGE" ? <IconPhoto size={34} /> : null}
            {preview.header.format === "VIDEO" ? <IconVideo size={34} /> : null}
            {preview.header.format === "DOCUMENT" ? <IconFile size={34} /> : null}
            {preview.header.format === "LOCATION" ? <IconMapPin size={34} /> : null}
            <Text size="xs" fw={600}>{titleCase(preview.header.format)} header</Text>
          </Stack>
        </Box>
      ) : null}
      <Box className={classes.bubbleContent}>
        {preview.header?.text ? <Text fw={700} size="sm" mb={4}>{preview.header.text}</Text> : null}
        <Text size="sm" className={classes.messageText}>{preview.body || "(Empty message body)"}</Text>
        {preview.footer ? <Text size="xs" c="dimmed" mt={7}>{preview.footer}</Text> : null}
        <div className={classes.messageTime}>12:41 ✓✓</div>
      </Box>
      {preview.buttons.map((button, index) => (
        <div className={classes.previewButton} key={`${button.type}-${index}`}>
          {button.text}
        </div>
      ))}
    </Box>
  </Box>
);

const BookingPicker = ({
  query,
  onQueryChange,
  selected,
  onSelect,
  bookings,
  loading,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  selected: WhatsAppTemplateBooking | null;
  onSelect: (booking: WhatsAppTemplateBooking | null) => void;
  bookings: WhatsAppTemplateBooking[];
  loading: boolean;
}) => (
  <Stack gap="xs">
    <TextInput
      label="Booking"
      placeholder="Search booking reference, guest, phone, or product"
      leftSection={<IconSearch size={16} />}
      value={query}
      onChange={(event) => onQueryChange(event.currentTarget.value)}
    />
    {loading ? <Text size="xs" c="dimmed">Searching bookings…</Text> : null}
    {query.trim().length >= 2 && !loading ? (
      <ScrollArea.Autosize mah={190} type="auto">
        <Stack gap={5}>
          {bookings.map((booking) => (
            <UnstyledButton
              key={booking.id}
              className={classes.templateOption}
              data-selected={selected?.id === booking.id || undefined}
              onClick={() => onSelect(booking)}
            >
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <Text fw={600} size="sm" truncate>{booking.reference} · {booking.guestName}</Text>
                  <Text size="xs" c="dimmed" truncate>{booking.productName}</Text>
                </Box>
                <Text size="xs" c="dimmed">{booking.phoneSuffix ? `•••• ${booking.phoneSuffix}` : "No phone"}</Text>
              </Group>
            </UnstyledButton>
          ))}
          {bookings.length === 0 ? <Text size="xs" c="dimmed">No matching bookings.</Text> : null}
        </Stack>
      </ScrollArea.Autosize>
    ) : null}
    {selected ? (
      <Group justify="space-between" gap="xs">
        <Badge color="teal" variant="light">Using {selected.reference}</Badge>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => onSelect(null)}>Clear</Button>
      </Group>
    ) : null}
  </Stack>
);

const SettingsWhatsAppTemplates = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>("preview");
  const [previewMode, setPreviewMode] = useState<"sample" | "booking">("sample");
  const [bookingQuery, setBookingQuery] = useState("");
  const [debouncedBookingQuery] = useDebouncedValue(bookingQuery.trim(), 300);
  const [selectedBooking, setSelectedBooking] = useState<WhatsAppTemplateBooking | null>(null);
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [builderPassword, setBuilderPassword] = useState("");
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [builderPreview, setBuilderPreview] = useState<{
    signature: string;
    preview: WhatsAppTemplatePreview;
  } | null>(null);
  const [insertTarget, setInsertTarget] = useState<"header" | "body">("body");
  const [protectedAction, setProtectedAction] = useState<ProtectedAction | null>(null);
  const [actionPassword, setActionPassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendOpened, setSendOpened] = useState(false);
  const [sendPassword, setSendPassword] = useState("");
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [pageFeedback, setPageFeedback] = useState<{ color: string; message: string } | null>(null);

  const templatesQuery = useQuery({
    queryKey: WHATSAPP_TEMPLATES_QUERY_KEY,
    queryFn: fetchWhatsAppTemplates,
    refetchInterval: 60_000,
  });
  const variablesQuery = useQuery({
    queryKey: WHATSAPP_TEMPLATE_VARIABLES_QUERY_KEY,
    queryFn: fetchWhatsAppTemplateVariables,
  });
  const bookingsQuery = useQuery({
    queryKey: ["whatsapp-template-bookings", debouncedBookingQuery],
    queryFn: () => searchWhatsAppTemplateBookings(debouncedBookingQuery),
    enabled: debouncedBookingQuery.length >= 2,
  });

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const selected = templates.find((template) => template.metaTemplateId === selectedId) ?? null;
  const selectedSendBlockReason = bookingSendBlockReason(selected);
  const currentBuilderPreviewSignature = useMemo(() => builder ? JSON.stringify({
    builder,
    previewMode,
    bookingId: previewMode === "booking" ? selectedBooking?.id ?? null : null,
  }) : null, [builder, previewMode, selectedBooking?.id]);
  const visibleBuilderPreview = builderPreview?.signature === currentBuilderPreviewSignature
    ? builderPreview.preview
    : null;
  const builderContainsAdvancedComponents = useMemo(() => {
    if (!builder || builder.editorMode !== "json") return false;
    try {
      const parsed = JSON.parse(builder.componentsJson) as unknown;
      return Array.isArray(parsed)
        && parsed.every(isRecord)
        && hasAdvancedComponents(parsed as WhatsAppTemplateComponent[]);
    } catch {
      return false;
    }
  }, [builder]);
  const existingAdvancedDefinitionLocked = Boolean(
    builder?.editingId
    && builder.category !== "AUTHENTICATION"
    && builderContainsAdvancedComponents,
  );

  useEffect(() => {
    if (!selectedId || !templates.some((template) => template.metaTemplateId === selectedId)) {
      setSelectedId(templates[0]?.metaTemplateId ?? null);
    }
  }, [selectedId, templates]);

  useEffect(() => {
    if (selected && !selected.bookingPreviewSupported && previewMode === "booking") {
      setPreviewMode("sample");
    }
  }, [previewMode, selected]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return templates.filter((template) => {
      if (statusFilter !== "all" && template.status !== statusFilter) return false;
      if (categoryFilter !== "all" && template.category !== categoryFilter) return false;
      if (!normalizedSearch) return true;
      return [template.name, template.language, template.category, template.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [categoryFilter, search, statusFilter, templates]);

  const selectedPreviewQuery = useQuery({
    queryKey: [
      "whatsapp-template-preview",
      selected?.metaTemplateId,
      selected?.lastSyncedAt,
      selected?.localState,
      previewMode,
      previewMode === "booking" ? selectedBooking?.id : null,
    ],
    queryFn: () => previewWhatsAppTemplate({
      metaTemplateId: selected!.metaTemplateId,
      bookingId: previewMode === "booking" ? selectedBooking?.id ?? null : null,
    }),
    enabled: Boolean(
      selected
      && (previewMode === "sample" || (selectedBooking && selected.bookingPreviewSupported)),
    ),
  });

  const sendPreviewQuery = useQuery({
    queryKey: [
      "whatsapp-template-send-preview",
      selected?.metaTemplateId,
      selected?.lastSyncedAt,
      selected?.localState,
      selectedBooking?.id,
    ],
    queryFn: () => previewWhatsAppTemplate({
      metaTemplateId: selected!.metaTemplateId,
      bookingId: selectedBooking!.id,
    }),
    enabled: Boolean(
      sendOpened
      && selected
      && selected.status === "APPROVED"
      && selected.bookingPreviewSupported
      && selectedBooking,
    ),
  });
  const sendPreviewReady = Boolean(sendPreviewQuery.isSuccess
    && !sendPreviewQuery.isFetching
    && sendPreviewQuery.data
    && sendPreviewQuery.data.missingVariables.length === 0);

  const eventsQuery = useQuery({
    queryKey: ["whatsapp-template-events", selected?.metaTemplateId],
    queryFn: () => fetchWhatsAppTemplateEvents(selected!.metaTemplateId),
    enabled: Boolean(selected && activeTab === "history"),
  });

  const refreshTemplates = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: WHATSAPP_TEMPLATES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-template-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-template-send-preview"] }),
    ]);
  };

  const writeMutation = useMutation({
    mutationFn: async (input: { definition: WhatsAppTemplateDefinition; id: string | null }) =>
      input.id
        ? updateWhatsAppTemplate(input.id, { ...input.definition, password: builderPassword })
        : createWhatsAppTemplate({ ...input.definition, password: builderPassword }),
    onSuccess: async (template) => {
      setBuilder(null);
      setBuilderPassword("");
      setBuilderPreview(null);
      setSelectedId(template.metaTemplateId);
      setPageFeedback({ color: "teal", message: `Template ${template.name} was submitted to Meta.` });
      await refreshTemplates();
    },
    onError: (error) => setBuilderError(extractErrorMessage(error)),
  });

  const builderPreviewMutation = useMutation({
    mutationFn: ({ signature: _signature, ...input }: {
      definition: WhatsAppTemplateDefinition;
      bookingId?: number | null;
      signature: string;
    }) =>
      previewWhatsAppTemplate(input),
    onSuccess: (preview, input) => {
      setBuilderPreview({ signature: input.signature, preview });
      setBuilderError(null);
    },
    onError: (error) => setBuilderError(extractErrorMessage(error)),
  });

  const protectedMutation = useMutation({
    mutationFn: async () => {
      if (!protectedAction) throw new Error("Choose an action first.");
      if (protectedAction.kind === "sync") return syncWhatsAppTemplates(actionPassword);
      if (protectedAction.kind === "archive") {
        return archiveWhatsAppTemplates([protectedAction.template.metaTemplateId], actionPassword);
      }
      if (protectedAction.kind === "unarchive") {
        return unarchiveWhatsAppTemplates([protectedAction.template.metaTemplateId], actionPassword);
      }
      if (protectedAction.kind === "unpause") {
        return unpauseWhatsAppTemplate(protectedAction.template.metaTemplateId, actionPassword);
      }
      await deleteWhatsAppTemplate(
        protectedAction.template.metaTemplateId,
        deleteConfirmation,
        actionPassword,
      );
      return null;
    },
    onSuccess: async () => {
      const action = protectedAction?.kind ?? "operation";
      setProtectedAction(null);
      setActionPassword("");
      setDeleteConfirmation("");
      setActionError(null);
      setPageFeedback({ color: "teal", message: `WhatsApp template ${action} completed.` });
      await refreshTemplates();
    },
    onError: (error) => setActionError(extractErrorMessage(error)),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !selectedBooking) throw new Error("Select a booking before sending.");
      const blocked = bookingSendBlockReason(selected);
      if (blocked) throw new Error(blocked);
      if (!sendPreviewReady) {
        throw new Error("Wait for the exact booking preview and resolve any missing information before sending.");
      }
      return sendManagedWhatsAppTemplate(selected.metaTemplateId, {
        password: sendPassword,
        bookingId: selectedBooking.id,
        ...(sendRecipient.trim() ? { recipient: sendRecipient.trim() } : {}),
      });
    },
    onSuccess: ({ messageId }) => {
      setSendFeedback(`Meta accepted the message. Reference: ${messageId}`);
      setSendPassword("");
    },
    onError: (error) => setSendFeedback(extractErrorMessage(error)),
  });

  const openBuilder = (template?: WhatsAppManagedTemplate) => {
    setBuilder(template ? builderFromTemplate(template) : createEmptyBuilder());
    setBuilderPassword("");
    setBuilderError(null);
    setBuilderPreview(null);
  };

  const buildDefinition = (): WhatsAppTemplateDefinition | null => {
    if (!builder) return null;
    try {
      const definition = definitionFromBuilder(builder);
      const error = validateDefinition(definition);
      if (error) throw new Error(error);
      return definition;
    } catch (error) {
      setBuilderError(extractErrorMessage(error));
      return null;
    }
  };

  const handleSaveBuilder = () => {
    const definition = buildDefinition();
    if (!definition) return;
    if (!builderPassword.trim()) {
      setBuilderError("Enter your administrator password to submit this change to Meta.");
      return;
    }
    setBuilderError(null);
    // Keep the password in the controlled input only. TanStack retains mutation
    // variables for diagnostics, so secret-bearing values must not be passed to mutate().
    writeMutation.mutate({ definition, id: builder?.editingId ?? null });
  };

  const handleBuilderPreview = () => {
    const definition = buildDefinition();
    if (!definition || !currentBuilderPreviewSignature) return;
    builderPreviewMutation.mutate({
      definition,
      bookingId: previewMode === "booking" ? selectedBooking?.id ?? null : null,
      signature: currentBuilderPreviewSignature,
    });
  };

  const insertVariable = (variable: WhatsAppTemplateVariable) => {
    if (!builder) return;
    if (builder.parameterFormat !== "NAMED") {
      setBuilderError("Booking variables use named parameters. Switch the parameter format to Named.");
      return;
    }
    const placeholder = `{{${variable.key}}}`;
    setBuilder({
      ...builder,
      ...(insertTarget === "header"
        ? { headerText: `${builder.headerText}${builder.headerText ? " " : ""}${placeholder}` }
        : { body: `${builder.body}${builder.body ? " " : ""}${placeholder}` }),
    });
    setBuilderError(null);
  };

  const changeEditorMode = (mode: string) => {
    if (!builder || (mode !== "visual" && mode !== "json")) return;
    if (mode === "visual" && builder.category === "AUTHENTICATION") {
      setBuilderError("Authentication templates use Meta-managed preset components and must stay in JSON mode.");
      return;
    }
    if (mode === "json" && builder.editorMode === "visual") {
      const components = visualComponents(builder);
      const definition = definitionFromBuilder(builder);
      setBuilder({
        ...builder,
        editorMode: "json",
        componentsJson: JSON.stringify(components, null, 2),
        bookingBindings: definition.bookingBindings ?? {},
        bindingSourceComponents: components,
      });
      return;
    }
    if (mode === "visual" && builder.editorMode === "json") {
      try {
        const parsed = JSON.parse(builder.componentsJson) as unknown;
        if (!Array.isArray(parsed) || parsed.some((component) => !isRecord(component))) {
          throw new Error("Components JSON must contain an array of objects.");
        }
        if (hasAdvancedComponents(parsed as WhatsAppTemplateComponent[])) {
          setBuilderError("This definition contains advanced components. Keep JSON mode to preserve them.");
          return;
        }
        const nextComponents = parsed as WhatsAppTemplateComponent[];
        const bookingBindings = reconciledBookingBindings(
          builder.bindingSourceComponents,
          nextComponents,
          builder.bookingBindings,
        );
        setBuilder({
          ...builder,
          ...simpleComponentsFrom(nextComponents, bookingBindings),
          bookingBindings,
          bindingSourceComponents: nextComponents,
          editorMode: "visual",
        });
        setBuilderError(null);
      } catch (error) {
        setBuilderError(extractErrorMessage(error));
      }
    }
  };

  const changeCategory = (value: string | null) => {
    if (!builder) return;
    const category = (value ?? "UTILITY") as WhatsAppTemplateCategory;
    if (category === "AUTHENTICATION" && builder.category !== "AUTHENTICATION") {
      const components = createAuthenticationComponents();
      setBuilder({
        ...builder,
        category,
        parameterFormat: "POSITIONAL",
        editorMode: "json",
        componentsJson: JSON.stringify(components, null, 2),
        bookingBindings: {},
        bindingSourceComponents: components,
      });
      setBuilderError(null);
      return;
    }
    setBuilder({ ...builder, category });
  };

  const openProtectedAction = (action: ProtectedAction) => {
    setProtectedAction(action);
    setActionPassword("");
    setDeleteConfirmation("");
    setActionError(null);
  };

  const protectedActionTitle = protectedAction
    ? protectedAction.kind === "sync"
      ? "Synchronize with Meta"
      : `${titleCase(protectedAction.kind)} ${protectedAction.template.name}`
    : "Confirm action";

  const confirmProtectedDisabled = !actionPassword.trim()
    || (protectedAction?.kind === "delete" && deleteConfirmation !== protectedAction.template.name);

  const statuses = Array.from(new Set(templates.map((template) => template.status))).sort();
  const categories = Array.from(new Set(templates.map((template) => template.category))).sort();
  const bookingResults = bookingsQuery.data ?? [];

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.settingsControlPanel}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group align="flex-start" gap="sm">
            <Tooltip label="Back to WhatsApp Business">
              <ActionIcon variant="subtle" color="gray" mt={2} onClick={() => navigate("/settings/whatsapp")}>
                <IconArrowLeft size={20} />
              </ActionIcon>
            </Tooltip>
            <div>
              <Group gap="xs">
                <ThemeIcon color="teal" variant="light"><IconTemplate size={20} /></ThemeIcon>
                <Title order={3}>WhatsApp templates</Title>
              </Group>
              <Text size="sm" c="dimmed" mt={4} maw={760}>
                Build, preview, submit, and monitor templates for the connected WhatsApp Business account.
                Previewing never sends a message.
              </Text>
            </div>
          </Group>
          <Group gap="sm">
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => openProtectedAction({ kind: "sync" })}>
              Sync from Meta
            </Button>
            <Button color="teal" leftSection={<IconPlus size={16} />} onClick={() => openBuilder()}>
              New template
            </Button>
          </Group>
        </Group>

        <Alert color="blue" icon={<IconEye size={18} />} title="Safe, approximate previews">
          Sample previews use synthetic values. Booking previews read the selected booking on the server. WhatsApp can render
          spacing, media, and buttons differently across devices, and no message is sent until you explicitly confirm Send.
        </Alert>

        {pageFeedback ? (
          <Alert color={pageFeedback.color} withCloseButton onClose={() => setPageFeedback(null)}>
            {pageFeedback.message}
          </Alert>
        ) : null}

        {templatesQuery.isError ? (
          <Alert color="red" title="Unable to load WhatsApp templates" icon={<IconAlertCircle size={18} />}>
            {extractErrorMessage(templatesQuery.error)}
          </Alert>
        ) : null}

        <Grid gutter="lg" align="stretch">
          <Grid.Col span={{ base: 12, lg: 4, xl: 3 }}>
            <Paper withBorder radius="lg" p="md" h="100%">
              <Stack gap="sm">
                <TextInput
                  placeholder="Search templates"
                  leftSection={<IconSearch size={16} />}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
                <SimpleGrid cols={2} spacing="xs">
                  <Select
                    aria-label="Filter by status"
                    value={statusFilter}
                    onChange={(value) => setStatusFilter(value ?? "all")}
                    data={[{ value: "all", label: "All statuses" }, ...statuses.map((status) => ({ value: status, label: titleCase(status) }))]}
                  />
                  <Select
                    aria-label="Filter by category"
                    value={categoryFilter}
                    onChange={(value) => setCategoryFilter(value ?? "all")}
                    data={[{ value: "all", label: "All categories" }, ...categories.map((category) => ({ value: category, label: titleCase(category) }))]}
                  />
                </SimpleGrid>
                <Text size="xs" c="dimmed">{filteredTemplates.length} of {templates.length} templates</Text>
                {templatesQuery.isLoading ? (
                  <Center mih={280}><Loader variant="dots" /></Center>
                ) : (
                  <ScrollArea h={650} type="auto" offsetScrollbars>
                    <Stack gap={7} pr="xs">
                      {filteredTemplates.map((template) => (
                        <UnstyledButton
                          key={template.metaTemplateId}
                          className={classes.templateOption}
                          data-selected={selected?.metaTemplateId === template.metaTemplateId || undefined}
                          onClick={() => setSelectedId(template.metaTemplateId)}
                        >
                          <Group justify="space-between" wrap="nowrap" align="flex-start">
                            <Box style={{ minWidth: 0 }}>
                              <Text fw={650} size="sm" truncate>{template.name}</Text>
                              <Text size="xs" c="dimmed">{template.language} · {titleCase(template.category)}</Text>
                            </Box>
                            <Stack gap={3} align="flex-end">
                              <Badge color={STATUS_COLORS[template.status] ?? "gray"} variant="light" size="xs">
                                {titleCase(template.status)}
                              </Badge>
                              {!isSynchronizedTemplate(template) ? (
                                <Badge color="orange" variant="dot" size="xs">Sync needed</Badge>
                              ) : null}
                            </Stack>
                          </Group>
                        </UnstyledButton>
                      ))}
                      {filteredTemplates.length === 0 ? (
                        <Text size="sm" c="dimmed" ta="center" py="xl">No templates match these filters.</Text>
                      ) : null}
                    </Stack>
                  </ScrollArea>
                )}
              </Stack>
            </Paper>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 8, xl: 9 }}>
            <Paper withBorder radius="lg" p={{ base: "sm", sm: "lg" }} h="100%">
              {selected ? (
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start" wrap="wrap">
                    <div>
                      <Title order={4}>{selected.name}</Title>
                      <Text size="sm" c="dimmed">{selected.language} · Meta ID {selected.metaTemplateId}</Text>
                    </div>
                    <Group gap="xs">
                      <Badge color={STATUS_COLORS[selected.status] ?? "gray"} variant="light">{titleCase(selected.status)}</Badge>
                      <Badge color={QUALITY_COLORS[selected.qualityScore ?? "UNKNOWN"] ?? "gray"} variant="dot">
                        Quality {titleCase(selected.qualityScore ?? "UNKNOWN")}
                      </Badge>
                      <Badge variant="outline">{titleCase(selected.category)}</Badge>
                    </Group>
                  </Group>

                  {selected.rejectedReason || selected.reasonInfo || selected.recommendationInfo ? (
                    <Alert color={selected.status === "REJECTED" ? "red" : "orange"} title="Meta review information">
                      <Stack gap={4}>
                        {selected.rejectedReason ? <Text size="sm">Reason: {selected.rejectedReason}</Text> : null}
                        {selected.reasonInfo ? <Text size="sm">{selected.reasonInfo}</Text> : null}
                        {selected.recommendationInfo ? <Text size="sm">Recommendation: {selected.recommendationInfo}</Text> : null}
                      </Stack>
                    </Alert>
                  ) : null}

                  {!isSynchronizedTemplate(selected) ? (
                    <Alert color="orange" title="Synchronize with Meta before making changes">
                      Local state: {titleCase(selected.localState ?? "unknown")}. {selected.bookingSupportReason}
                    </Alert>
                  ) : null}

                  <Group gap="xs" wrap="wrap">
                    <Tooltip
                      label={canEditTemplate(selected)
                        ? "Edit the complete component definition"
                        : !isSynchronizedTemplate(selected)
                          ? "Synchronize this template before editing"
                          : "Meta only allows edits while a template is approved, rejected, or paused"}
                    >
                      <span>
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconEdit size={15} />}
                          disabled={!canEditTemplate(selected)}
                          onClick={() => openBuilder(selected)}
                        >
                          Edit
                        </Button>
                      </span>
                    </Tooltip>
                    {selected.status === "APPROVED" ? (
                      <>
                        <Tooltip label={selectedSendBlockReason ?? "Render this template with a booking and send it"}>
                          <span>
                            <Button
                              size="xs"
                              color="teal"
                              leftSection={<IconSend size={15} />}
                              disabled={Boolean(selectedSendBlockReason)}
                              onClick={() => {
                                setSendOpened(true);
                                setSendPassword("");
                                setSendRecipient("");
                                setSendFeedback(null);
                              }}
                            >
                              Send with booking
                            </Button>
                          </span>
                        </Tooltip>
                        <Button size="xs" variant="default" leftSection={<IconArchive size={15} />} disabled={!isSynchronizedTemplate(selected)} onClick={() => openProtectedAction({ kind: "archive", template: selected })}>
                          Archive
                        </Button>
                      </>
                    ) : null}
                    {selected.status === "ARCHIVED" ? (
                      <Button size="xs" variant="default" leftSection={<IconArchiveOff size={15} />} disabled={!isSynchronizedTemplate(selected)} onClick={() => openProtectedAction({ kind: "unarchive", template: selected })}>
                        Unarchive
                      </Button>
                    ) : null}
                    {selected.status === "PAUSED" ? (
                      <Button size="xs" color="orange" disabled={!isSynchronizedTemplate(selected)} onClick={() => openProtectedAction({ kind: "unpause", template: selected })}>
                        Unpause
                      </Button>
                    ) : null}
                    {selected.status !== "DELETED" ? (
                      <Button size="xs" color="red" variant="subtle" leftSection={<IconTrash size={15} />} disabled={!isSynchronizedTemplate(selected)} onClick={() => openProtectedAction({ kind: "delete", template: selected })}>
                        Delete
                      </Button>
                    ) : null}
                  </Group>

                  {selected.status === "APPROVED" && selectedSendBlockReason ? (
                    <Alert color="yellow" title="Booking send unavailable for this format">
                      {selectedSendBlockReason} The template remains visible and can still be managed and synchronized.
                    </Alert>
                  ) : null}

                  <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
                    <Tabs.List>
                      <Tabs.Tab value="preview" leftSection={<IconEye size={15} />}>Preview</Tabs.Tab>
                      <Tabs.Tab value="definition" leftSection={<IconBraces size={15} />}>Definition</Tabs.Tab>
                      <Tabs.Tab value="history" leftSection={<IconHistory size={15} />}>Status history</Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="preview" pt="lg">
                      <Grid gutter="xl">
                        <Grid.Col span={{ base: 12, md: 5 }}>
                          <Stack gap="md">
                            <SegmentedControl
                              fullWidth
                              value={previewMode}
                              onChange={(value) => setPreviewMode(value as "sample" | "booking")}
                              data={[
                                { value: "sample", label: "Sample data" },
                                { value: "booking", label: "Real booking", disabled: !selected.bookingPreviewSupported },
                              ]}
                            />
                            {!selected.bookingPreviewSupported ? (
                              <Alert color="yellow" title="Booking preview unavailable">
                                {selected.bookingSupportReason ?? "This template cannot safely resolve booking fields."}
                              </Alert>
                            ) : null}
                            {previewMode === "booking" ? (
                              <BookingPicker
                                query={bookingQuery}
                                onQueryChange={setBookingQuery}
                                selected={selectedBooking}
                                onSelect={setSelectedBooking}
                                bookings={bookingResults}
                                loading={bookingsQuery.isFetching}
                              />
                            ) : null}
                            <Card withBorder radius="md" padding="sm">
                              <Stack gap={5}>
                                <Text size="xs" c="dimmed">Parameter format</Text>
                                <Text size="sm" fw={600}>{titleCase(selected.parameterFormat)}</Text>
                                <Text size="xs" c="dimmed">Message TTL</Text>
                                <Text size="sm" fw={600}>{selected.messageSendTtlSeconds === null ? "Meta default" : `${selected.messageSendTtlSeconds.toLocaleString()} seconds`}</Text>
                                <Text size="xs" c="dimmed">Last synchronized</Text>
                                <Text size="sm" fw={600}>{formatDateTime(selected.lastSyncedAt)}</Text>
                              </Stack>
                            </Card>
                          </Stack>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 7 }}>
                          {selectedPreviewQuery.isLoading || selectedPreviewQuery.isFetching ? (
                            <Center mih={420}><Loader variant="dots" /></Center>
                          ) : selectedPreviewQuery.isError ? (
                            <Alert color="red" title="Preview could not be rendered">
                              {extractErrorMessage(selectedPreviewQuery.error)}
                            </Alert>
                          ) : selectedPreviewQuery.data ? (
                            <Stack gap="lg">
                              <PreviewPhone preview={selectedPreviewQuery.data} />
                              {selectedPreviewQuery.data.missingVariables.length ? (
                                <Alert color="red" title="Booking information is missing">
                                  {selectedPreviewQuery.data.missingVariables.join(", ")}
                                </Alert>
                              ) : null}
                              {selectedPreviewQuery.data.variables.length ? (
                                <ScrollArea type="auto">
                                  <Table striped withTableBorder miw={600}>
                                    <Table.Thead><Table.Tr><Table.Th>Parameter</Table.Th><Table.Th>Source</Table.Th><Table.Th>Resolved value</Table.Th></Table.Tr></Table.Thead>
                                    <Table.Tbody>
                                      {selectedPreviewQuery.data.variables.map((variable) => (
                                        <Table.Tr key={variable.key}>
                                          <Table.Td><Code>{`{{${variable.key}}}`}</Code></Table.Td>
                                          <Table.Td><Text size="xs">{variable.source}</Text></Table.Td>
                                          <Table.Td>
                                            {variable.missing ? <Badge color="red">Missing</Badge> : <Text size="sm">{variable.value}</Text>}
                                          </Table.Td>
                                        </Table.Tr>
                                      ))}
                                    </Table.Tbody>
                                  </Table>
                                </ScrollArea>
                              ) : null}
                            </Stack>
                          ) : (
                            <Center mih={360}><Text c="dimmed">Select a booking to render its information.</Text></Center>
                          )}
                        </Grid.Col>
                      </Grid>
                    </Tabs.Panel>

                    <Tabs.Panel value="definition" pt="lg">
                      <Stack gap="md">
                        {hasAdvancedComponents(selected.components) ? (
                          <Alert color="violet" title="Advanced Meta components">
                            This template contains a media, location, carousel, catalog, Flow, OTP, or other advanced component.
                            Its complete provider definition is preserved below.
                          </Alert>
                        ) : null}
                        <JsonInput
                          label="Meta components"
                          value={JSON.stringify(selected.components, null, 2)}
                          readOnly
                          autosize
                          minRows={12}
                          maxRows={24}
                          validationError="Invalid component JSON"
                        />
                      </Stack>
                    </Tabs.Panel>

                    <Tabs.Panel value="history" pt="lg">
                      {eventsQuery.isLoading ? <Center mih={220}><Loader variant="dots" /></Center> : null}
                      {eventsQuery.isError ? <Alert color="red">{extractErrorMessage(eventsQuery.error)}</Alert> : null}
                      {eventsQuery.data ? (
                        <Stack gap="sm">
                          {eventsQuery.data.map((event) => (
                            <Card key={event.id} withBorder radius="md" padding="sm">
                              <Group justify="space-between" align="flex-start">
                                <div>
                                  <Text fw={600} size="sm">{titleCase(event.eventType)}</Text>
                                  <Text size="xs" c="dimmed">{event.source} · {formatDateTime(event.occurredAt)}</Text>
                                </div>
                                {event.eventValue ? <Badge variant="light">{titleCase(event.eventValue)}</Badge> : null}
                              </Group>
                              {event.previousValue ? <Text size="xs" mt={6}>Previous: {event.previousValue}</Text> : null}
                              {event.payload ? <Code block mt="xs" className={classes.codeBlock}>{JSON.stringify(event.payload, null, 2)}</Code> : null}
                            </Card>
                          ))}
                          {eventsQuery.data.length === 0 ? <Text c="dimmed" ta="center" py="xl">No lifecycle events recorded yet.</Text> : null}
                        </Stack>
                      ) : null}
                    </Tabs.Panel>
                  </Tabs>
                </Stack>
              ) : (
                <Center mih={520}><Text c="dimmed">Select a template or create a new one.</Text></Center>
              )}
            </Paper>
          </Grid.Col>
        </Grid>
      </Stack>

      <Modal
        opened={Boolean(builder)}
        onClose={() => !writeMutation.isPending && setBuilder(null)}
        title={builder?.editingId ? `Edit ${builder.name}` : "Create WhatsApp template"}
        size="90rem"
        centered
        closeOnClickOutside={false}
      >
        {builder ? (
          <Grid gutter="xl">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    label="Template name"
                    description="Lowercase letters, numbers, and underscores"
                    value={builder.name}
                    disabled={Boolean(builder.editingId)}
                    onChange={(event) => setBuilder({ ...builder, name: event.currentTarget.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  />
                  <TextInput
                    label="Language"
                    description="For example en_US or pl_PL"
                    value={builder.language}
                    disabled={Boolean(builder.editingId)}
                    onChange={(event) => setBuilder({ ...builder, language: event.currentTarget.value })}
                  />
                  <Select
                    label="Category"
                    data={CATEGORY_OPTIONS}
                    value={builder.category}
                    disabled={builder.editingStatus === "APPROVED"}
                    onChange={changeCategory}
                  />
                  <Select
                    label="Parameter format"
                    data={[{ value: "NAMED", label: "Named (recommended)" }, { value: "POSITIONAL", label: "Positional (advanced)" }]}
                    value={builder.parameterFormat}
                    disabled={Boolean(builder.editingId)}
                    onChange={(value) => setBuilder({ ...builder, parameterFormat: (value ?? "NAMED") as WhatsAppTemplateParameterFormat })}
                  />
                  <NumberInput
                    label="Message TTL in seconds"
                    description={builder.editingId
                      ? "Leave empty to keep the current TTL. Use -1 only where Meta supports its default TTL."
                      : "Leave empty to use Meta's default. Use -1 only where Meta supports it."}
                    value={builder.ttl}
                    min={-1}
                    allowDecimal={false}
                    onChange={(value) => setBuilder({ ...builder, ttl: value })}
                  />
                </SimpleGrid>

                <Group justify="space-between">
                  <SegmentedControl
                    value={builder.editorMode}
                    onChange={changeEditorMode}
                    data={[
                      {
                        value: "visual",
                        label: "Common components",
                        disabled: builder.category === "AUTHENTICATION",
                      },
                      { value: "json", label: "Advanced JSON" },
                    ]}
                  />
                  <Button variant="light" leftSection={<IconEye size={16} />} loading={builderPreviewMutation.isPending} onClick={handleBuilderPreview}>
                    Render preview
                  </Button>
                </Group>

                {builder.parameterFormat === "POSITIONAL" ? (
                  <Alert color="yellow" title="Positional parameters are advanced">
                    Booking-aware variables use stable named parameters. Use Named unless an existing Meta template specifically
                    requires positional parameters and mappings.
                  </Alert>
                ) : null}

                {builder.editingId ? (
                  <Alert color="blue" title="Meta replaces the complete component definition">
                    Name, language, and parameter format cannot be changed. Category is also fixed while a template is approved.
                    Submitting an update replaces the full component array, even when only one field changed.
                  </Alert>
                ) : null}

                {builder.editorMode === "visual" ? (
                  <Stack gap="md">
                    <Textarea
                      label="Text header"
                      description="Optional, maximum 60 characters and one variable"
                      maxLength={60}
                      autosize
                      minRows={2}
                      value={builder.headerText}
                      onChange={(event) => setBuilder({ ...builder, headerText: event.currentTarget.value })}
                    />
                    <Textarea
                      label="Message body"
                      description={`${builder.body.length}/1024 characters`}
                      maxLength={1024}
                      autosize
                      minRows={6}
                      value={builder.body}
                      onChange={(event) => setBuilder({ ...builder, body: event.currentTarget.value })}
                    />
                    <Textarea
                      label="Footer"
                      description="Optional, maximum 60 characters; variables are not supported"
                      maxLength={60}
                      autosize
                      minRows={2}
                      value={builder.footer}
                      onChange={(event) => setBuilder({ ...builder, footer: event.currentTarget.value })}
                    />

                    <Divider label="Buttons" labelPosition="left" />
                    {builder.buttons.map((button, index) => (
                      <Card withBorder radius="md" padding="sm" key={index}>
                        <SimpleGrid cols={{ base: 1, sm: button.type === "QUICK_REPLY" ? 2 : 3 }}>
                          <Select
                            label="Type"
                            data={[
                              { value: "URL", label: "Open website" },
                              { value: "PHONE_NUMBER", label: "Call phone" },
                              { value: "QUICK_REPLY", label: "Quick reply" },
                            ]}
                            value={button.type}
                            onChange={(value) => {
                              const buttons = [...builder.buttons];
                              buttons[index] = {
                                ...button,
                                type: (value ?? "QUICK_REPLY") as SimpleButton["type"],
                                value: "",
                                variableKey: "",
                              };
                              setBuilder({ ...builder, buttons });
                            }}
                          />
                          <TextInput
                            label="Button label"
                            value={button.text}
                            onChange={(event) => {
                              const buttons = [...builder.buttons];
                              buttons[index] = { ...button, text: event.currentTarget.value };
                              setBuilder({ ...builder, buttons });
                            }}
                          />
                          {button.type !== "QUICK_REPLY" ? (
                            <TextInput
                              label={button.type === "URL" ? "URL" : "Phone number"}
                               placeholder={button.type === "URL" ? "https://example.com/booking/{{1}}" : "+48123456789"}
                              value={button.value}
                              onChange={(event) => {
                                const buttons = [...builder.buttons];
                                buttons[index] = { ...button, value: event.currentTarget.value };
                                setBuilder({ ...builder, buttons });
                              }}
                            />
                          ) : null}
                        </SimpleGrid>
                        {button.type === "URL" && button.value.includes("{{1}}") ? (
                          <Select
                            mt="xs"
                            label="Dynamic URL booking value"
                            description="Meta URL buttons use {{1}}; this local mapping keeps the booking field explicit."
                            placeholder="Choose a booking field"
                            searchable
                            clearable
                            data={(variablesQuery.data ?? []).map((variable) => ({
                              value: variable.key,
                              label: `${variable.label} (${variable.source})`,
                            }))}
                            value={button.variableKey || null}
                            onChange={(value) => {
                              const buttons = [...builder.buttons];
                              buttons[index] = { ...button, variableKey: value ?? "" };
                              setBuilder({ ...builder, buttons });
                            }}
                          />
                        ) : null}
                        <Button
                          mt="xs"
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          leftSection={<IconX size={13} />}
                          onClick={() => setBuilder({ ...builder, buttons: builder.buttons.filter((_value, buttonIndex) => buttonIndex !== index) })}
                        >
                          Remove
                        </Button>
                      </Card>
                    ))}
                    <Button
                      variant="default"
                      size="xs"
                      leftSection={<IconPlus size={14} />}
                      disabled={builder.buttons.length >= 10}
                      onClick={() => setBuilder({
                        ...builder,
                        buttons: [...builder.buttons, {
                          type: "QUICK_REPLY",
                          text: "",
                          value: "",
                          variableKey: "",
                        }],
                      })}
                    >
                      Add button
                    </Button>

                    <Divider label="Booking variables" labelPosition="left" />
                    <Select
                      label="Insert variables into"
                      value={insertTarget}
                      onChange={(value) => setInsertTarget(value === "header" ? "header" : "body")}
                      data={[{ value: "body", label: "Message body" }, { value: "header", label: "Text header" }]}
                    />
                    {variablesQuery.isError ? <Alert color="red">{extractErrorMessage(variablesQuery.error)}</Alert> : null}
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                      {(variablesQuery.data ?? []).map((variable) => (
                        <Tooltip key={variable.key} label={`${variable.source} · Example: ${variable.sampleValue}`} multiline maw={360}>
                          <Button
                            className={classes.variableButton}
                            variant="default"
                            justify="space-between"
                            rightSection={<Code>{`{{${variable.key}}}`}</Code>}
                            onClick={() => insertVariable(variable)}
                          >
                            {variable.label}
                          </Button>
                        </Tooltip>
                      ))}
                    </SimpleGrid>
                  </Stack>
                ) : (
                  <Stack gap="sm">
                    <Alert
                      color="violet"
                      title={builder.category === "AUTHENTICATION"
                        ? "Authentication component editor"
                        : existingAdvancedDefinitionLocked
                          ? "Advanced definition is read-only"
                          : "Advanced component editor"}
                    >
                      {builder.category === "AUTHENTICATION"
                        ? "Meta supplies the fixed authentication message text. Edit the supported BODY, FOOTER, and OTP settings here without adding custom BODY text."
                        : existingAdvancedDefinitionLocked
                        ? "This existing template uses components the booking sender does not safely support. Its complete provider definition is preserved and shown without offering a destructive rewrite."
                        : "Use this for media, location, Flow, catalog, carousel, offer, and future Meta components. The full JSON is sent to the server for validation; unknown component fields are preserved. Authentication creation is not enabled yet."}
                    </Alert>
                    <JsonInput
                      label="Components JSON"
                      value={builder.componentsJson}
                      onChange={(value) => setBuilder({ ...builder, componentsJson: value })}
                      readOnly={existingAdvancedDefinitionLocked}
                      formatOnBlur
                      autosize
                      minRows={18}
                      maxRows={30}
                      validationError="Components must be valid JSON"
                    />
                  </Stack>
                )}

                <PasswordInput
                  label="Administrator password"
                  description="Required only when you submit the create or update operation to Meta"
                  value={builderPassword}
                  onChange={(event) => setBuilderPassword(event.currentTarget.value)}
                  autoComplete="current-password"
                />
                {builderError ? <Alert color="red" icon={<IconAlertCircle size={18} />}>{builderError}</Alert> : null}
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => setBuilder(null)} disabled={writeMutation.isPending}>Cancel</Button>
                  <Button
                    color="teal"
                    onClick={handleSaveBuilder}
                    loading={writeMutation.isPending}
                    disabled={existingAdvancedDefinitionLocked}
                  >
                    {builder.editingId ? "Submit update" : "Submit for review"}
                  </Button>
                </Group>
              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 5 }}>
              <Stack gap="md">
                <SegmentedControl
                  fullWidth
                  value={previewMode}
                  onChange={(value) => setPreviewMode(value as "sample" | "booking")}
                  data={[{ value: "sample", label: "Sample data" }, { value: "booking", label: "Real booking" }]}
                />
                {previewMode === "booking" ? (
                  <BookingPicker
                    query={bookingQuery}
                    onQueryChange={setBookingQuery}
                    selected={selectedBooking}
                    onSelect={setSelectedBooking}
                    bookings={bookingResults}
                    loading={bookingsQuery.isFetching}
                  />
                ) : null}
                {visibleBuilderPreview ? (
                  <>
                    <PreviewPhone preview={visibleBuilderPreview} />
                    {visibleBuilderPreview.missingVariables.length ? (
                      <Alert color="red" title="Missing booking information">{visibleBuilderPreview.missingVariables.join(", ")}</Alert>
                    ) : null}
                  </>
                ) : (
                  <Center mih={420}>
                    <Stack align="center" gap="xs">
                      <IconEye size={32} opacity={0.45} />
                      <Text c="dimmed" ta="center">Choose data and render a preview to see the message.</Text>
                    </Stack>
                  </Center>
                )}
              </Stack>
            </Grid.Col>
          </Grid>
        ) : null}
      </Modal>

      <Modal
        opened={Boolean(protectedAction)}
        onClose={() => !protectedMutation.isPending && setProtectedAction(null)}
        title={protectedActionTitle}
        centered
      >
        <Stack gap="md">
          {protectedAction?.kind === "sync" ? (
            <Text size="sm">Fetch every template and its current status from Meta. This does not send a message.</Text>
          ) : null}
          {protectedAction?.kind === "delete" ? (
            <>
              <Alert color="red" title="Permanent Meta operation">
                Deletion cannot be undone, may affect all language variants, and Meta can reserve the name after deletion.
              </Alert>
              <TextInput
                label={`Type ${protectedAction.template.name} to confirm`}
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
              />
            </>
          ) : null}
          <PasswordInput
            label="Administrator password"
            value={actionPassword}
            onChange={(event) => setActionPassword(event.currentTarget.value)}
            autoComplete="current-password"
          />
          {actionError ? <Alert color="red">{actionError}</Alert> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setProtectedAction(null)} disabled={protectedMutation.isPending}>Cancel</Button>
            <Button
              color={protectedAction?.kind === "delete" ? "red" : "teal"}
              disabled={confirmProtectedDisabled}
              loading={protectedMutation.isPending}
              onClick={() => protectedMutation.mutate()}
            >
              Confirm {protectedAction?.kind ? titleCase(protectedAction.kind).toLowerCase() : "action"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={sendOpened}
        onClose={() => !sendMutation.isPending && setSendOpened(false)}
        title={selected ? `Send ${selected.name}` : "Send WhatsApp template"}
        centered
        size="lg"
      >
        <Stack gap="md">
          <Alert color="orange" icon={<IconSend size={18} />} title="This sends a real WhatsApp message">
            Confirm the booking and preview first. Meta acceptance is not a delivery confirmation.
          </Alert>
          <BookingPicker
            query={bookingQuery}
            onQueryChange={setBookingQuery}
            selected={selectedBooking}
            onSelect={setSelectedBooking}
            bookings={bookingResults}
            loading={bookingsQuery.isFetching}
          />
          {selectedBooking ? (
            sendPreviewQuery.isLoading || sendPreviewQuery.isFetching ? (
              <Center mih={260}><Loader variant="dots" /></Center>
            ) : sendPreviewQuery.isError ? (
              <Alert color="red" title="The required send preview could not be rendered">
                {extractErrorMessage(sendPreviewQuery.error)}
              </Alert>
            ) : sendPreviewQuery.data ? (
              <Stack gap="sm">
                <PreviewPhone preview={sendPreviewQuery.data} />
                {sendPreviewQuery.data.missingVariables.length ? (
                  <Alert color="red" title="Resolve missing booking information before sending">
                    {sendPreviewQuery.data.missingVariables.join(", ")}
                  </Alert>
                ) : (
                  <Alert color="teal" icon={<IconCheck size={18} />}>
                    This preview is bound to {selectedBooking.reference} and is ready to send.
                  </Alert>
                )}
              </Stack>
            ) : null
          ) : (
            <Alert color="blue">Select a booking to render the exact message before sending.</Alert>
          )}
          <TextInput
            label="Recipient override (optional)"
            description="Leave empty to use the booking's phone number; otherwise enter E.164 format"
            placeholder="+48502484066"
            value={sendRecipient}
            onChange={(event) => setSendRecipient(event.currentTarget.value)}
          />
          <PasswordInput
            label="Administrator password"
            value={sendPassword}
            onChange={(event) => setSendPassword(event.currentTarget.value)}
            autoComplete="current-password"
          />
          {sendFeedback ? (
            <Alert color={sendMutation.isSuccess ? "teal" : "red"} icon={sendMutation.isSuccess ? <IconCheck size={18} /> : <IconAlertCircle size={18} />}>
              {sendFeedback}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSendOpened(false)} disabled={sendMutation.isPending}>Close</Button>
            <Button
              color="teal"
              leftSection={<IconSend size={16} />}
              disabled={!selectedBooking
                || !sendPassword.trim()
                || !sendPreviewReady
                || sendMutation.isPending
                || selected?.status !== "APPROVED"}
              loading={sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
            >
              Send message now
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default SettingsWhatsAppTemplates;
