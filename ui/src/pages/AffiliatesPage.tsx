import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Modal,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Paper,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  PasswordInput,
  NumberInput,
  Title,
  ThemeIcon,
  ScrollArea,
  Accordion,
  ActionIcon,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCalendarEvent,
  IconChartBar,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { isAxiosError } from "axios";
import dayjs from "dayjs";
import { navigateToPage } from "../actions/navigationActions";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import AffiliateChartSection from "../components/affiliates/AffiliateChartSection";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { createUser, updateUser } from "../actions/userActions";
import { useAppDispatch } from "../store/hooks";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import type { User } from "../types/users/User";
import type { UserType } from "../types/userTypes/UserType";
import axiosInstance from "../utils/axiosInstance";
import {
  fetchAffiliateOverview,
  createAffiliatePayout,
  saveAffiliateAssignments,
  undoAffiliatePayout,
  type AffiliateAssignmentRule,
  type AffiliateOverviewResponse,
} from "../api/affiliates";
import type { FinanceAccount, FinanceCategory } from "../types/finance";

const PAGE_SLUG = PAGE_SLUGS.affiliates;

type DatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "last_7_days"
  | "last_14_days"
  | "this_month"
  | "last_month"
  | "all_time"
  | "custom";

type DateRangeValue = [Date | null, Date | null];

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom" },
];

const formatMoney = (value: number, currency?: string | null): string => {
  if (currency === "PLN") {
    return `${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)} z\u0142`;
  }

  if (currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatCount = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);

const centeredTableStyles = {
  th: {
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
  },
  td: {
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
  },
};

const formatDisplayRange = (range: DateRangeValue): string => {
  const [start, end] = range;
  if (!start || !end) {
    return "Select a range";
  }
  const startLabel = dayjs(start).format("MMM D, YYYY");
  const endLabel = dayjs(end).format("MMM D, YYYY");
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
};

const createRange = (start: Date, end: Date): DateRangeValue => [start, end];

const getPresetRange = (preset: Exclude<DatePreset, "custom">, reference: dayjs.Dayjs = dayjs()): DateRangeValue => {
  const today = reference.startOf("day");
  switch (preset) {
    case "today":
      return createRange(today.toDate(), today.toDate());
    case "yesterday": {
      const yesterday = today.subtract(1, "day");
      return createRange(yesterday.toDate(), yesterday.toDate());
    }
    case "this_week":
      return createRange(today.startOf("week").toDate(), today.toDate());
    case "last_week": {
      const lastWeekEnd = today.startOf("week").subtract(1, "day");
      return createRange(lastWeekEnd.startOf("week").toDate(), lastWeekEnd.toDate());
    }
    case "last_7_days": {
      const yesterday = today.subtract(1, "day");
      return createRange(yesterday.subtract(6, "day").toDate(), yesterday.toDate());
    }
    case "last_14_days": {
      const yesterday = today.subtract(1, "day");
      return createRange(yesterday.subtract(13, "day").toDate(), yesterday.toDate());
    }
    case "this_month":
      return createRange(today.startOf("month").toDate(), today.toDate());
    case "last_month": {
      const lastMonthEnd = today.startOf("month").subtract(1, "day");
      return createRange(lastMonthEnd.startOf("month").toDate(), lastMonthEnd.toDate());
    }
    case "all_time":
      return createRange(new Date("2000-01-01T00:00:00.000Z"), today.toDate());
  }
};

const MetricCard = ({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description?: string;
  icon: ReactNode;
}) => (
  <Card withBorder radius="lg" p="md" shadow="xs">
    <Stack gap={8} align="center">
      <ThemeIcon radius="xl" variant="light" size="lg">
        {icon}
      </ThemeIcon>
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center" style={{ letterSpacing: "0.12em" }}>
        {label}
      </Text>
      <Text fw={800} fz={{ base: 24, sm: 28 }} ta="center">
        {value}
      </Text>
      {description ? (
        <Text size="sm" c="dimmed" ta="center">
          {description}
        </Text>
      ) : null}
    </Stack>
  </Card>
);

const BookingsPeopleCard = ({
  bookingCount,
  peopleCount,
}: {
  bookingCount: string;
  peopleCount: string;
}) => (
  <Card withBorder radius="lg" p="md" shadow="xs">
    <SimpleGrid cols={2} spacing="md" w="100%">
      <Stack gap={6} align="center">
        <ThemeIcon radius="xl" variant="light" size="lg">
          <IconCalendarEvent size={18} />
        </ThemeIcon>
        <Stack gap={2} align="center">
          <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center" style={{ letterSpacing: "0.08em" }}>
            Bookings
          </Text>
          <Text fw={800} fz={{ base: 24, sm: 28 }} ta="center">
            {bookingCount}
          </Text>
        </Stack>
      </Stack>
      <Stack gap={6} align="center">
        <ThemeIcon radius="xl" variant="light" size="lg">
          <IconUsers size={18} />
        </ThemeIcon>
        <Stack gap={2} align="center">
          <Text size="xs" tt="uppercase" fw={700} c="dimmed" ta="center" style={{ letterSpacing: "0.08em" }}>
            People
          </Text>
          <Text fw={800} fz={{ base: 24, sm: 28 }} ta="center">
            {peopleCount}
          </Text>
        </Stack>
      </Stack>
    </SimpleGrid>
  </Card>
);

const SectionCard = ({ title, icon, right, children }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <Card withBorder radius="lg" p="md" shadow="xs">
    <Stack gap="md">
      <div style={{ position: "relative", minHeight: 44 }}>
        <Group gap="sm" wrap="nowrap" justify="center">
          <ThemeIcon radius="xl" variant="light" size="lg">
            {icon}
          </ThemeIcon>
          <Text fw={800} size="lg" ta="center">
            {title}
          </Text>
        </Group>
        {right ? (
          <div style={{ position: "absolute", top: 0, right: 0 }}>
            {right}
          </div>
        ) : null}
      </div>
      {children}
    </Stack>
  </Card>
);

const formatBookingDate = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : "-";
};

const normalizeRule = (rule: AffiliateAssignmentRule): AffiliateAssignmentRule => ({
  ...rule,
  utmSource: rule.utmSource?.trim() ? rule.utmSource.trim() : null,
  utmMedium: rule.utmMedium?.trim() ? rule.utmMedium.trim() : null,
  utmCampaign: rule.utmCampaign?.trim() ? rule.utmCampaign.trim() : null,
  notes: rule.notes?.trim() ? rule.notes.trim() : null,
});

const parseCsvValues = (value: string | null): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

const makeRuleId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const buildEmptyRule = (
  source: Pick<AffiliateOverviewResponse, "affiliateUsers" | "currentUser"> | null | undefined,
): AffiliateAssignmentRule => ({
  id: makeRuleId(),
  userId: source?.affiliateUsers?.[0]?.id ?? source?.currentUser.id ?? 0,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  notes: null,
});

type AffiliateUserFormState = {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  affiliateCommissionPerPerson: string;
};

const INITIAL_AFFILIATE_USER_FORM: AffiliateUserFormState = {
  firstName: "",
  lastName: "",
  email: "",
  username: "",
  password: "",
  affiliateCommissionPerPerson: "0",
};

type AffiliatePayoutFormState = {
  accountId: string;
  categoryId: string;
  paidDate: Date | null;
  note: string;
};

const INITIAL_AFFILIATE_PAYOUT_FORM: AffiliatePayoutFormState = {
  accountId: "",
  categoryId: "",
  paidDate: new Date(),
  note: "",
};

const normalizeText = (value?: string | null): string => (value ?? "").trim();

const extractErrorMessage = (error: unknown): string => {
  if (isAxiosError(error)) {
    const payload = error.response?.data as unknown;

    if (Array.isArray(payload) && payload[0] && typeof payload[0] === "object") {
      const firstEntry = payload[0] as { message?: unknown };
      if (typeof firstEntry.message === "string" && firstEntry.message.trim()) {
        return firstEntry.message;
      }
    }

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const normalizedPayload = payload as {
        message?: unknown;
        errors?: Array<{ msg?: unknown; message?: unknown }>;
      };
      if (typeof normalizedPayload.message === "string" && normalizedPayload.message.trim()) {
        return normalizedPayload.message;
      }
      if (Array.isArray(normalizedPayload.errors) && normalizedPayload.errors[0]) {
        const firstError = normalizedPayload.errors[0];
        if (typeof firstError.msg === "string" && firstError.msg.trim()) {
          return firstError.msg;
        }
        if (typeof firstError.message === "string" && firstError.message.trim()) {
          return firstError.message;
        }
      }
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred";
};

const extractCreatedUserId = (payload: unknown): number | null => {
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0] as { id?: unknown };
    return typeof first?.id === "number" ? first.id : null;
  }
  if (payload && typeof payload === "object") {
    const maybe = payload as { id?: unknown };
    return typeof maybe.id === "number" ? maybe.id : null;
  }
  return null;
};

const AffiliatesPage = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [preset, setPreset] = useState<DatePreset>("this_month");
  const [range, setRange] = useState<DateRangeValue>(() => getPresetRange("this_month"));
  const [affiliateFilter, setAffiliateFilter] = useState<string>("all");
  const [data, setData] = useState<AffiliateOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftRules, setDraftRules] = useState<AffiliateAssignmentRule[]>([]);
  const [createAffiliateUserOpen, setCreateAffiliateUserOpen] = useState(false);
  const [createAffiliateUserForm, setCreateAffiliateUserForm] = useState<AffiliateUserFormState>(INITIAL_AFFILIATE_USER_FORM);
  const [createAffiliateUserError, setCreateAffiliateUserError] = useState<string | null>(null);
  const [createAffiliateUserLoading, setCreateAffiliateUserLoading] = useState(false);
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutForm, setPayoutForm] = useState<AffiliatePayoutFormState>(INITIAL_AFFILIATE_PAYOUT_FORM);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [undoPayoutId, setUndoPayoutId] = useState<number | null>(null);
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);
  const [financeCategories, setFinanceCategories] = useState<FinanceCategory[]>([]);
  const [userTypes, setUserTypes] = useState<Partial<UserType>[]>([]);
  const initializedDraftRulesRef = useRef(false);
  const lastLoadedOverviewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    dispatch(navigateToPage("Affiliates"));
  }, [dispatch, title]);

  useEffect(() => {
    let active = true;

    const loadUserTypes = async () => {
      try {
        const response = await axiosInstance.get<Array<{ data?: Partial<UserType>[] }>>("/userTypes", {
          withCredentials: true,
        });
        if (!active) {
          return;
        }
        const nextUserTypes = Array.isArray(response.data?.[0]?.data) ? response.data[0].data : [];
        setUserTypes(nextUserTypes);
      } catch {
        if (!active) {
          return;
        }
        setUserTypes([]);
      }
    };

    void loadUserTypes();

    return () => {
      active = false;
    };
  }, []);

  const canManageAssignments = Boolean(data?.currentUser.canManageAssignments);
  const selectedAffiliateUserId = affiliateFilter === "all" ? null : Number(affiliateFilter);
  const startDate = useMemo(() => dayjs(range[0] ?? new Date()).format("YYYY-MM-DD"), [range]);
  const endDate = useMemo(() => dayjs(range[1] ?? range[0] ?? new Date()).format("YYYY-MM-DD"), [range]);
  const overviewKey = useMemo(
    () => `${startDate}|${endDate}|${selectedAffiliateUserId == null ? "all" : selectedAffiliateUserId}`,
    [endDate, selectedAffiliateUserId, startDate],
  );
  const affiliateOptions = useMemo(
    () => [
      { value: "all", label: "All affiliates" },
      ...(data?.affiliateUsers ?? []).map((affiliate) => ({
        value: String(affiliate.id),
        label: affiliate.fullName,
      })),
    ],
    [data?.affiliateUsers],
  );
  const affiliateUserTypeId = useMemo(() => {
    const affiliateType = userTypes.find((userType) => {
      const slug = normalizeText(userType.slug).toLowerCase();
      const name = normalizeText(userType.name).toLowerCase();
      return slug === "affiliate" || name === "affiliate";
    });
    return typeof affiliateType?.id === "number" ? affiliateType.id : null;
  }, [userTypes]);

  const loadOverview = useCallback(async (
    start: string,
    end: string,
    affiliateUserId: number | null,
    options?: { force?: boolean; keepCurrentData?: boolean },
  ) => {
    const nextKey = `${start}|${end}|${affiliateUserId == null ? "all" : affiliateUserId}`;
    if (!options?.force && lastLoadedOverviewKeyRef.current === nextKey) {
      return null;
    }

    lastLoadedOverviewKeyRef.current = nextKey;
    setLoading(true);
    setError(null);

    try {
      const next = await fetchAffiliateOverview(start, end, affiliateUserId);
      setData(next);
      if (!initializedDraftRulesRef.current) {
        setDraftRules(next.assignments.rules.length > 0 ? next.assignments.rules : [buildEmptyRule(next)]);
        initializedDraftRulesRef.current = true;
      }
      if (!next.currentUser.canManageAssignments) {
        setAffiliateFilter("all");
      }
      return next;
    } catch (err: unknown) {
      lastLoadedOverviewKeyRef.current = null;
      const message = isAxiosError(err) ? err.response?.data?.message ?? err.message : "Unable to load affiliate overview";
      setError(message);
      if (!options?.keepCurrentData) {
        setData(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManageAssignments) {
      setFinanceAccounts([]);
      setFinanceCategories([]);
      return;
    }

    let active = true;

    const loadFinanceOptions = async () => {
      try {
        const [accountsResponse, categoriesResponse] = await Promise.all([
          axiosInstance.get<FinanceAccount[]>("/finance/accounts", { withCredentials: true }),
          axiosInstance.get<FinanceCategory[]>("/finance/categories", { withCredentials: true }),
        ]);
        if (!active) {
          return;
        }
        setFinanceAccounts(Array.isArray(accountsResponse.data) ? accountsResponse.data.filter((account) => account.isActive) : []);
        setFinanceCategories(
          Array.isArray(categoriesResponse.data)
            ? categoriesResponse.data.filter((category) => category.isActive && category.kind === "expense")
            : [],
        );
      } catch {
        if (!active) {
          return;
        }
        setFinanceAccounts([]);
        setFinanceCategories([]);
      }
    };

    void loadFinanceOptions();

    return () => {
      active = false;
    };
  }, [canManageAssignments]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const next = await loadOverview(startDate, endDate, selectedAffiliateUserId);
      if (!active || !next) {
        return;
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [loadOverview, overviewKey, selectedAffiliateUserId, startDate, endDate]);

  useEffect(() => {
    if (!canManageAssignments) {
      return;
    }
    if (draftRules.length === 0) {
      setDraftRules([buildEmptyRule(data)]);
    }
  }, [canManageAssignments, data, draftRules.length]);

  const applyPreset = (value: Exclude<DatePreset, "custom">) => {
    setPreset(value);
    setRange(getPresetRange(value));
  };

  const addRule = () => {
    setDraftRules((current) => [...current, buildEmptyRule(data)]);
  };

  const updateRule = (ruleId: string, patch: Partial<AffiliateAssignmentRule>) => {
    setDraftRules((current) =>
      current.map((rule) => (rule.id === ruleId ? normalizeRule({ ...rule, ...patch }) : rule)),
    );
  };

  const removeRule = (ruleId: string) => {
    setDraftRules((current) => current.filter((rule) => rule.id !== ruleId));
  };

  const handleSaveAssignments = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      const cleanedRules = draftRules.map((rule) => normalizeRule(rule)).filter((rule) => rule.userId > 0);
      await saveAffiliateAssignments(cleanedRules);
      const refreshed = await loadOverview(startDate, endDate, selectedAffiliateUserId, { force: true, keepCurrentData: true });
      if (!refreshed) {
        throw new Error("Unable to refresh affiliate overview after saving assignments");
      }
      setData(refreshed);
      setDraftRules(refreshed.assignments.rules.length > 0 ? refreshed.assignments.rules : [buildEmptyRule(refreshed)]);
    } catch (err: unknown) {
      const message = isAxiosError(err) ? err.response?.data?.message ?? err.message : "Unable to save affiliate assignments";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAffiliateUser = async () => {
    const firstName = createAffiliateUserForm.firstName.trim();
    const lastName = createAffiliateUserForm.lastName.trim();
    const email = createAffiliateUserForm.email.trim();
    const username = createAffiliateUserForm.username.trim();
    const password = createAffiliateUserForm.password.trim();
    const affiliateCommissionPerPerson = Number(createAffiliateUserForm.affiliateCommissionPerPerson);

    if (!firstName) {
      setCreateAffiliateUserError("First name is required.");
      return;
    }
    if (!lastName) {
      setCreateAffiliateUserError("Last name is required.");
      return;
    }
    if (!email) {
      setCreateAffiliateUserError("Email is required.");
      return;
    }
    if (!username) {
      setCreateAffiliateUserError("Username is required.");
      return;
    }
    if (password.length < 8) {
      setCreateAffiliateUserError("Password must be at least 8 characters.");
      return;
    }
    if (!Number.isFinite(affiliateCommissionPerPerson) || affiliateCommissionPerPerson < 0) {
      setCreateAffiliateUserError("Commission per person must be a valid positive amount.");
      return;
    }
    if (!affiliateUserTypeId) {
      setCreateAffiliateUserError("Affiliate role was not found. Check the user type catalog.");
      return;
    }

    setCreateAffiliateUserLoading(true);
    setCreateAffiliateUserError(null);
    setSaveError(null);

    try {
      const createPayload: Partial<User> = {
        firstName,
        lastName,
        email,
        username,
        password,
      };

      const createResult = await dispatch(createUser(createPayload)).unwrap();
      const createdUserId = extractCreatedUserId(createResult);

      if (!createdUserId) {
        throw new Error("The new affiliate user was created without a valid ID.");
      }

      await dispatch(
        updateUser({
          userId: createdUserId,
          userData: {
            userTypeId: affiliateUserTypeId,
            status: true,
            affiliateCommissionRate: affiliateCommissionPerPerson,
          },
        }),
      ).unwrap();

      const refreshed = await loadOverview(startDate, endDate, selectedAffiliateUserId, { force: true, keepCurrentData: true });
      if (!refreshed) {
        throw new Error("Unable to refresh affiliate overview after creating the affiliate user");
      }
      setData(refreshed);
      setDraftRules(refreshed.assignments.rules.length > 0 ? refreshed.assignments.rules : [buildEmptyRule(refreshed)]);
      setCreateAffiliateUserForm(INITIAL_AFFILIATE_USER_FORM);
      setCreateAffiliateUserOpen(false);
    } catch (err: unknown) {
      setCreateAffiliateUserError(extractErrorMessage(err));
    } finally {
      setCreateAffiliateUserLoading(false);
    }
  };

  const handleOpenPayoutModal = () => {
    setPayoutError(null);
    setPayoutForm(INITIAL_AFFILIATE_PAYOUT_FORM);
    setPayoutModalOpen(true);
  };

  const handleCreatePayout = async () => {
    if (!selectedAffiliateUserId) {
      setPayoutError("Select a specific affiliate before creating a payout.");
      return;
    }
    if (!payoutForm.accountId) {
      setPayoutError("Finance account is required.");
      return;
    }
    if (!payoutForm.categoryId) {
      setPayoutError("Expense category is required.");
      return;
    }
    if (!payoutForm.paidDate) {
      setPayoutError("Paid date is required.");
      return;
    }

    try {
      setPayoutLoading(true);
      setPayoutError(null);
      await createAffiliatePayout({
        affiliateUserId: selectedAffiliateUserId,
        startDate,
        endDate,
        accountId: Number(payoutForm.accountId),
        categoryId: Number(payoutForm.categoryId),
        paidDate: dayjs(payoutForm.paidDate).format("YYYY-MM-DD"),
        note: payoutForm.note.trim() || null,
      });
      await loadOverview(startDate, endDate, selectedAffiliateUserId, { force: true, keepCurrentData: true });
      setPayoutModalOpen(false);
      setPayoutForm(INITIAL_AFFILIATE_PAYOUT_FORM);
    } catch (err: unknown) {
      setPayoutError(extractErrorMessage(err));
    } finally {
      setPayoutLoading(false);
    }
  };

  const handleUndoPayout = async (payoutLogId: number) => {
    try {
      setUndoPayoutId(payoutLogId);
      setPayoutError(null);
      await undoAffiliatePayout(payoutLogId);
      await loadOverview(startDate, endDate, selectedAffiliateUserId, { force: true, keepCurrentData: true });
    } catch (err: unknown) {
      setPayoutError(extractErrorMessage(err));
    } finally {
      setUndoPayoutId(null);
    }
  };

  const revenueCurrency = data?.bookings.find((booking) => booking.currency)?.currency ?? "PLN";
  const isAffiliateViewer = (data?.currentUser.roleSlug ?? "").trim().toLowerCase() === "affiliate";
  const showRevenueDetails = !isAffiliateViewer;
  const utmCatalog = data?.utmCatalog ?? { utmSource: [], utmMedium: [], utmCampaign: [] };
  const payoutAccountOptions = financeAccounts.map((account) => ({
    value: String(account.id),
    label: `${account.name} (${account.currency})`,
  }));
  const payoutCategoryOptions = financeCategories.map((category) => ({
    value: String(category.id),
    label: category.name,
  }));
  const selectedAffiliate = data?.affiliateUsers.find((affiliate) => affiliate.id === selectedAffiliateUserId) ?? null;
  const canPaySelectedAffiliate = canManageAssignments && selectedAffiliateUserId != null && data != null && data.summary.commissionOutstandingTotal > 0;

  const sourceRows = data?.sourceBreakdown ?? [];
  const mediumRows = data?.mediumBreakdown ?? [];
  const campaignRows = data?.campaignBreakdown ?? [];
  const bookings = useMemo(() => data?.bookings ?? [], [data?.bookings]);
  const peopleCount = useMemo(
    () => bookings.reduce((sum, booking) => sum + (Number.isFinite(booking.partySizeTotal) ? booking.partySizeTotal : 0), 0),
    [bookings],
  );

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <Paper withBorder radius="xl" p={isMobile ? "md" : "lg"} shadow="sm">
          <Stack gap="md">
            <Group justify="center" align="center">
              <Group gap="sm" wrap="nowrap" justify="center">
                <ThemeIcon size={isMobile ? 42 : 48} radius="xl" variant="filled" color="dark">
                  <IconChartBar size={isMobile ? 22 : 26} />
                </ThemeIcon>
                <Stack gap={0} align="center">
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                    Affiliate Sales
                  </Text>
                  <Title order={isMobile ? 2 : 1}>{title}</Title>
                </Stack>
              </Group>
            </Group>

            {canManageAssignments ? (
              <Group justify="center">
                <Select
                  data={affiliateOptions}
                  value={affiliateFilter}
                  onChange={(value) => setAffiliateFilter(value ?? "all")}
                  w={isMobile ? "100%" : 260}
                  checkIconPosition="right"
                  allowDeselect={false}
                  styles={{
                    input: { textAlign: "center", fontWeight: 700 },
                    dropdown: { textAlign: "center" },
                    options: { textAlign: "center" },
                    option: { justifyContent: "center", textAlign: "center", fontWeight: 600 },
                  }}
                />
              </Group>
            ) : null}

            <Stack gap="sm" mx="auto" style={{ width: "100%", maxWidth: 860 }}>
              <Group gap="sm" wrap="wrap" align="center" justify="center">
                <Select
                  value={preset}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }
                    if (value === "custom") {
                      setPreset("custom");
                      return;
                    }
                    applyPreset(value as Exclude<DatePreset, "custom">);
                  }}
                  data={DATE_PRESET_OPTIONS}
                  placeholder="This Month"
                  size={isMobile ? "xs" : "sm"}
                  w={isMobile ? "100%" : 220}
                  checkIconPosition="right"
                  allowDeselect={false}
                  styles={{
                    input: { textAlign: "center", fontWeight: 700 },
                    dropdown: { textAlign: "center" },
                    options: { textAlign: "center" },
                    option: { justifyContent: "center", textAlign: "center", fontWeight: 600 },
                  }}
                />
                {preset === "custom" && (
                  <DatePickerInput
                    type="range"
                    value={range}
                    onChange={(nextRange) => {
                      const normalized: DateRangeValue = [nextRange[0] ?? null, nextRange[1] ?? null];
                      setPreset("custom");
                      setRange(normalized);
                    }}
                    placeholder="Select custom range"
                    size={isMobile ? "xs" : "sm"}
                    valueFormat="YYYY-MM-DD"
                    clearable
                    w={isMobile ? "100%" : 280}
                    styles={{
                      input: { textAlign: "center" },
                    }}
                  />
                )}
              </Group>

              <Text size="sm" c="dimmed" ta="center">
                {formatDisplayRange(range)}
              </Text>
            </Stack>
          </Stack>
        </Paper>

        {error ? (
          <Alert color="red" radius="lg" title="Affiliate overview unavailable">
            {error}
          </Alert>
        ) : null}

        {saveError ? (
          <Alert color="red" radius="lg" title="Assignment save failed">
            {saveError}
          </Alert>
        ) : null}

        {loading && !data ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : null}

            {data ? (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: showRevenueDetails ? 5 : 4 }} spacing="md">
              <BookingsPeopleCard bookingCount={formatCount(data.summary.bookingCount)} peopleCount={formatCount(peopleCount)} />
              {showRevenueDetails ? (
                <MetricCard
                  label="Revenue"
                  value={formatMoney(data.summary.revenueTotal, revenueCurrency)}
                  icon={<IconChartBar size={18} />}
                />
              ) : null}
              <MetricCard
                label="Commission"
                value={formatMoney(data.summary.commissionTotal, revenueCurrency)}
                icon={<IconDeviceFloppy size={18} />}
              />
              <MetricCard
                label="Outstanding"
                value={formatMoney(data.summary.commissionOutstandingTotal, revenueCurrency)}
                icon={<IconChartBar size={18} />}
              />
              <MetricCard
                label="Paid"
                value={formatMoney(data.summary.commissionPaidTotal, revenueCurrency)}
                icon={<IconUsers size={18} />}
              />
            </SimpleGrid>

            <AffiliateChartSection
              data={data.dailySeries}
              formatCount={formatCount}
              formatMoney={formatMoney}
              revenueCurrency={revenueCurrency}
              isMobile={Boolean(isMobile)}
              showRevenue={showRevenueDetails}
              sectionCard={(children) => (
                <SectionCard title={showRevenueDetails ? "Sales trend" : "Commission trend"} icon={<IconChartBar size={18} />}>
                  {children}
                </SectionCard>
              )}
            />

            <SectionCard title="Bookings" icon={<IconUsers size={18} />}>
              <ScrollArea h={520}>
                <Table stickyHeader withColumnBorders highlightOnHover styles={centeredTableStyles}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Booking</Table.Th>
                      <Table.Th>Guest</Table.Th>
                      <Table.Th>Product</Table.Th>
                      <Table.Th>Guests</Table.Th>
                      <Table.Th>Rate Per Person</Table.Th>
                      {showRevenueDetails ? <Table.Th>Revenue</Table.Th> : null}
                      <Table.Th>Commission</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Affiliate</Table.Th>
                      <Table.Th>UTM</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {bookings.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={showRevenueDetails ? 11 : 10}>
                          <Text c="dimmed" ta="center">
                            No bookings found for this range
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      bookings.map((booking) => (
                        <Table.Tr key={booking.id}>
                          <Table.Td>{formatBookingDate(booking.sourceReceivedAt)}</Table.Td>
                          <Table.Td>{booking.platformBookingId}</Table.Td>
                          <Table.Td>{booking.guestName}</Table.Td>
                          <Table.Td>{booking.productName ?? "-"}</Table.Td>
                          <Table.Td>{formatCount(booking.partySizeTotal)}</Table.Td>
                          <Table.Td>
                            {booking.affiliateCommissionPerPerson != null
                              ? formatMoney(booking.affiliateCommissionPerPerson, booking.currency ?? revenueCurrency)
                              : "-"}
                          </Table.Td>
                          {showRevenueDetails ? (
                            <Table.Td>{formatMoney(booking.baseAmount, booking.currency ?? revenueCurrency)}</Table.Td>
                          ) : null}
                          <Table.Td>
                            {formatMoney(booking.affiliateCommissionAmount, booking.currency ?? revenueCurrency)}
                          </Table.Td>
                          <Table.Td>{booking.isCommissionPaid ? "Paid" : "Outstanding"}</Table.Td>
                          <Table.Td>{booking.affiliateUserName ?? "-"}</Table.Td>
                          <Table.Td>
                            <Stack gap={4} align="center">
                              <Text size="xs" c="dimmed" ta="center">
                                Source: {booking.utmSource ?? "-"}
                              </Text>
                              <Text size="xs" c="dimmed" ta="center">
                                Medium: {booking.utmMedium ?? "-"}
                              </Text>
                              <Text size="xs" c="dimmed" ta="center">
                                Campaign: {booking.utmCampaign ?? "-"}
                              </Text>
                            </Stack>
                          </Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </SectionCard>

            {showRevenueDetails ? (
              <>
                <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                  <SectionCard title="Breakdown by source" icon={<IconCalendarEvent size={18} />}>
                    <ScrollArea h={320}>
                      <Table stickyHeader withColumnBorders highlightOnHover styles={centeredTableStyles}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Source</Table.Th>
                            <Table.Th>Bookings</Table.Th>
                            <Table.Th>Revenue</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {sourceRows.length === 0 ? (
                            <Table.Tr>
                              <Table.Td colSpan={3}>
                                <Text c="dimmed" ta="center">
                                  No source data
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ) : (
                            sourceRows.map((row) => (
                              <Table.Tr key={row.label}>
                                <Table.Td>{row.label}</Table.Td>
                                <Table.Td>{formatCount(row.bookingCount)}</Table.Td>
                                <Table.Td>{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                              </Table.Tr>
                            ))
                          )}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  </SectionCard>

                  <SectionCard title="Breakdown by campaign" icon={<IconCalendarEvent size={18} />}>
                    <ScrollArea h={320}>
                      <Table stickyHeader withColumnBorders highlightOnHover styles={centeredTableStyles}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Campaign</Table.Th>
                            <Table.Th>Bookings</Table.Th>
                            <Table.Th>Revenue</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {campaignRows.length === 0 ? (
                            <Table.Tr>
                              <Table.Td colSpan={3}>
                                <Text c="dimmed" ta="center">
                                  No campaign data
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ) : (
                            campaignRows.map((row) => (
                              <Table.Tr key={row.label}>
                                <Table.Td>{row.label}</Table.Td>
                                <Table.Td>{formatCount(row.bookingCount)}</Table.Td>
                                <Table.Td>{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                              </Table.Tr>
                            ))
                          )}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  </SectionCard>
                </SimpleGrid>

                <SectionCard title="Breakdown by medium" icon={<IconCalendarEvent size={18} />}>
                  <ScrollArea h={280}>
                    <Table stickyHeader withColumnBorders highlightOnHover styles={centeredTableStyles}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Medium</Table.Th>
                          <Table.Th>Bookings</Table.Th>
                          <Table.Th>Revenue</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {mediumRows.length === 0 ? (
                          <Table.Tr>
                            <Table.Td colSpan={3}>
                              <Text c="dimmed" ta="center">
                                No medium data
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ) : (
                          mediumRows.map((row) => (
                            <Table.Tr key={row.label}>
                              <Table.Td>{row.label}</Table.Td>
                              <Table.Td>{formatCount(row.bookingCount)}</Table.Td>
                              <Table.Td>{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                            </Table.Tr>
                          ))
                        )}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </SectionCard>
              </>
            ) : null}

            <SectionCard
              title="Affiliate payouts"
              icon={<IconDeviceFloppy size={18} />}
              right={
                canPaySelectedAffiliate ? (
                  <Button onClick={handleOpenPayoutModal}>
                    Pay outstanding
                  </Button>
                ) : undefined
              }
            >
              {payoutError ? (
                <Alert color="red" radius="md" title="Affiliate payout error">
                  {payoutError}
                </Alert>
              ) : null}

              <ScrollArea h={320}>
                <Table stickyHeader withColumnBorders highlightOnHover styles={centeredTableStyles}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Affiliate</Table.Th>
                      <Table.Th>Date paid</Table.Th>
                      <Table.Th>Range</Table.Th>
                      <Table.Th>Bookings</Table.Th>
                      <Table.Th>Amount</Table.Th>
                      <Table.Th>Note</Table.Th>
                      {canManageAssignments ? <Table.Th>Actions</Table.Th> : null}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.payoutLogs.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={canManageAssignments ? 7 : 6}>
                          <Text c="dimmed" ta="center">
                            No affiliate payouts in this range
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      data.payoutLogs.map((payoutLog) => (
                        <Table.Tr key={payoutLog.id}>
                          <Table.Td>{payoutLog.affiliateUserName}</Table.Td>
                          <Table.Td>{formatBookingDate(payoutLog.paidDate)}</Table.Td>
                          <Table.Td>
                            {formatBookingDate(payoutLog.rangeStart)} - {formatBookingDate(payoutLog.rangeEnd)}
                          </Table.Td>
                          <Table.Td>{formatCount(payoutLog.bookingCount)}</Table.Td>
                          <Table.Td>{formatMoney(payoutLog.amount, payoutLog.currencyCode)}</Table.Td>
                          <Table.Td>{payoutLog.note ?? "-"}</Table.Td>
                          {canManageAssignments ? (
                            <Table.Td>
                              <Button
                                size="xs"
                                variant="light"
                                color="red"
                                loading={undoPayoutId === payoutLog.id}
                                onClick={() => handleUndoPayout(payoutLog.id)}
                              >
                                Undo payout
                              </Button>
                            </Table.Td>
                          ) : null}
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </SectionCard>

            {showRevenueDetails ? (
              <Accordion variant="separated" radius="lg">
                <Accordion.Item value="tags">
                  <Accordion.Control>
                    <Text fw={800} ta="center">
                      Discovered UTM tags
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
                      <TagListCard title="utm_source" rows={data.discoveredTags.utmSource} currency={revenueCurrency} showRevenue={showRevenueDetails} />
                      <TagListCard title="utm_medium" rows={data.discoveredTags.utmMedium} currency={revenueCurrency} showRevenue={showRevenueDetails} />
                      <TagListCard title="utm_campaign" rows={data.discoveredTags.utmCampaign} currency={revenueCurrency} showRevenue={showRevenueDetails} />
                    </SimpleGrid>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            ) : null}

            {canManageAssignments ? (
              <SectionCard
                title="Affiliate assignments"
                icon={<IconUsers size={18} />}
                right={
                  <Group gap="xs">
                    <Button variant="default" onClick={() => {
                      setCreateAffiliateUserError(null);
                      setCreateAffiliateUserForm(INITIAL_AFFILIATE_USER_FORM);
                      setCreateAffiliateUserOpen(true);
                    }}>
                      Create affiliate user
                    </Button>
                    <Button variant="light" leftSection={<IconPlus size={16} />} onClick={addRule}>
                      Add rule
                    </Button>
                  </Group>
                }
              >
                <Stack gap="md">
                  {draftRules.map((rule, index) => (
                    <Card key={rule.id} withBorder radius="md" p="md">
                      <Stack gap="sm">
                        <Group justify="space-between" align="center">
                          <Text fw={700}>Rule {index + 1}</Text>
                          <ActionIcon variant="light" color="red" aria-label="Delete rule" onClick={() => removeRule(rule.id)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>

                        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                          <Select
                            label="Affiliate user"
                            data={data.affiliateUsers.map((affiliate) => ({
                              value: String(affiliate.id),
                              label: affiliate.fullName,
                            }))}
                            value={String(rule.userId)}
                            onChange={(value) => {
                              if (!value) {
                                return;
                              }
                              updateRule(rule.id, { userId: Number(value) });
                            }}
                          />
                          <TextInput
                            label="Notes"
                            value={rule.notes ?? ""}
                            onChange={(event) => updateRule(rule.id, { notes: event.currentTarget.value })}
                          />
                          <MultiSelect
                            label="UTM Source"
                            data={utmCatalog.utmSource}
                            searchable
                            clearable
                            comboboxProps={{ withinPortal: true }}
                            nothingFoundMessage="No catalog values found"
                            placeholder="Select source tags"
                            value={parseCsvValues(rule.utmSource)}
                            onChange={(value) =>
                              updateRule(rule.id, { utmSource: value.length > 0 ? value.join(', ') : null })
                            }
                          />
                          <MultiSelect
                            label="UTM Medium"
                            data={utmCatalog.utmMedium}
                            searchable
                            clearable
                            comboboxProps={{ withinPortal: true }}
                            nothingFoundMessage="No catalog values found"
                            placeholder="Select medium tags"
                            value={parseCsvValues(rule.utmMedium)}
                            onChange={(value) =>
                              updateRule(rule.id, { utmMedium: value.length > 0 ? value.join(', ') : null })
                            }
                          />
                          <MultiSelect
                            label="UTM Campaign"
                            data={utmCatalog.utmCampaign}
                            searchable
                            clearable
                            comboboxProps={{ withinPortal: true }}
                            nothingFoundMessage="No catalog values found"
                            placeholder="Select campaign tags"
                            value={parseCsvValues(rule.utmCampaign)}
                            onChange={(value) =>
                              updateRule(rule.id, { utmCampaign: value.length > 0 ? value.join(', ') : null })
                            }
                          />
                        </SimpleGrid>
                      </Stack>
                    </Card>
                  ))}

                  <Group justify="flex-end">
                    <Button leftSection={<IconDeviceFloppy size={16} />} onClick={handleSaveAssignments} loading={saving}>
                      Save assignments
                    </Button>
                  </Group>
                </Stack>
              </SectionCard>
            ) : null}
          </>
        ) : null}
      </Stack>

      <Modal
        opened={payoutModalOpen}
        onClose={() => {
          if (payoutLoading) {
            return;
          }
          setPayoutModalOpen(false);
          setPayoutError(null);
        }}
        title="Create Affiliate Payout"
        centered
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          {payoutError ? (
            <Alert color="red" radius="md" title="Affiliate payout failed">
              {payoutError}
            </Alert>
          ) : null}

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Paper withBorder radius="md" p="sm">
              <Stack gap={2}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  Affiliate
                </Text>
                <Text fw={700}>{selectedAffiliate?.fullName ?? "-"}</Text>
              </Stack>
            </Paper>
            <Paper withBorder radius="md" p="sm">
              <Stack gap={2}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  Outstanding commission
                </Text>
                <Text fw={700}>{formatMoney(data?.summary.commissionOutstandingTotal ?? 0, revenueCurrency)}</Text>
              </Stack>
            </Paper>
            <Paper withBorder radius="md" p="sm">
              <Stack gap={2}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  Unpaid bookings
                </Text>
                <Text fw={700}>{formatCount(data?.summary.unpaidBookingCount ?? 0)}</Text>
              </Stack>
            </Paper>
            <Paper withBorder radius="md" p="sm">
              <Stack gap={2}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  Range
                </Text>
                <Text fw={700}>{formatDisplayRange(range)}</Text>
              </Stack>
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Select
              label="Finance account"
              data={payoutAccountOptions}
              value={payoutForm.accountId}
              onChange={(value) => setPayoutForm((current) => ({ ...current, accountId: value ?? "" }))}
              searchable
              nothingFoundMessage="No active accounts"
            />
            <Select
              label="Expense category"
              data={payoutCategoryOptions}
              value={payoutForm.categoryId}
              onChange={(value) => setPayoutForm((current) => ({ ...current, categoryId: value ?? "" }))}
              searchable
              nothingFoundMessage="No active expense categories"
            />
            <DatePickerInput
              label="Paid date"
              value={payoutForm.paidDate}
              onChange={(value) => setPayoutForm((current) => ({ ...current, paidDate: value }))}
            />
            <TextInput
              label="Note"
              value={payoutForm.note}
              onChange={(event) => setPayoutForm((current) => ({ ...current, note: event.currentTarget.value }))}
            />
          </SimpleGrid>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPayoutModalOpen(false)} disabled={payoutLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreatePayout} loading={payoutLoading}>
              Create payout
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={createAffiliateUserOpen}
        onClose={() => {
          if (createAffiliateUserLoading) {
            return;
          }
          setCreateAffiliateUserOpen(false);
          setCreateAffiliateUserError(null);
        }}
        title="Create Affiliate User"
        centered
        fullScreen={Boolean(isMobile)}
      >
        <Stack gap="md">
          {createAffiliateUserError ? (
            <Alert color="red" radius="md" title="User creation failed">
              {createAffiliateUserError}
            </Alert>
          ) : null}

          {!affiliateUserTypeId ? (
            <Alert color="orange" radius="md" title="Affiliate role missing">
              The `affiliate` user type could not be found. Create or seed that role first.
            </Alert>
          ) : null}

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="First name"
              value={createAffiliateUserForm.firstName}
              onChange={(event) =>
                setCreateAffiliateUserForm((current) => ({ ...current, firstName: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Last name"
              value={createAffiliateUserForm.lastName}
              onChange={(event) =>
                setCreateAffiliateUserForm((current) => ({ ...current, lastName: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Email"
              type="email"
              value={createAffiliateUserForm.email}
              onChange={(event) =>
                setCreateAffiliateUserForm((current) => ({ ...current, email: event.currentTarget.value }))
              }
            />
            <TextInput
              label="Username"
              value={createAffiliateUserForm.username}
              onChange={(event) =>
                setCreateAffiliateUserForm((current) => ({ ...current, username: event.currentTarget.value }))
              }
            />
            <PasswordInput
              label="Password"
              value={createAffiliateUserForm.password}
              onChange={(event) =>
                setCreateAffiliateUserForm((current) => ({ ...current, password: event.currentTarget.value }))
              }
            />
            <NumberInput
              label="Commission per person (PLN)"
              min={0}
              decimalScale={2}
              fixedDecimalScale={false}
              value={createAffiliateUserForm.affiliateCommissionPerPerson}
              onChange={(value) =>
                setCreateAffiliateUserForm((current) => ({
                  ...current,
                  affiliateCommissionPerPerson: value === "" ? "" : String(value),
                }))
              }
            />
            <TextInput label="Role" value="Affiliate" disabled />
          </SimpleGrid>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateAffiliateUserOpen(false)} disabled={createAffiliateUserLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreateAffiliateUser} loading={createAffiliateUserLoading} disabled={!affiliateUserTypeId}>
              Create affiliate user
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

const TagListCard = ({
  title,
  rows,
  currency,
  showRevenue,
}: {
  title: string;
  rows: Array<{ value: string; bookingCount: number; revenue: number; commission: number }>;
  currency?: string | null;
  showRevenue: boolean;
}) => (
  <Card withBorder radius="md" p="md">
    <Stack gap="sm">
      <Text fw={800} ta="center">
        {title}
      </Text>
      <Divider />
      <Stack gap={6}>
        {rows.length === 0 ? (
          <Text c="dimmed" size="sm">
            No values discovered
          </Text>
        ) : (
          rows.map((row) => (
            <Group key={row.value} justify="space-between" wrap="nowrap">
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600} lineClamp={1}>
                  {row.value}
                </Text>
                <Text size="xs" c="dimmed" ta="center">
                  {formatCount(row.bookingCount)} bookings
                </Text>
              </Stack>
              <Text size="sm" fw={700} style={{ whiteSpace: "nowrap" }}>
                {formatMoney(showRevenue ? row.revenue : row.commission, currency)}
              </Text>
            </Group>
          ))
        )}
      </Stack>
    </Stack>
  </Card>
);

export default AffiliatesPage;
