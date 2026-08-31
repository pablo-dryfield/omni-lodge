import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  Pagination,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowsExchange,
  IconArrowsLeftRight,
  IconDownload,
  IconEdit,
  IconFileUpload,
  IconLock,
  IconPlus,
  IconWallet,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceTransaction,
  createFinanceTransfer,
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceClients,
  fetchFinanceTransactionById,
  fetchFinanceTransactions,
  fetchFinanceVendors,
  updateFinanceTransaction,
  uploadFinanceFile,
} from "../../actions/financeActions";
import { fetchStaffProfiles } from "../../actions/staffProfileActions";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceFiles,
  selectFinanceTransactions,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { FinanceTransaction } from "../../types/finance";
import type { StaffProfile } from "../../types/staffProfiles/StaffProfile";
import dayjs from "dayjs";
import { compressImageFile } from "../../utils/imageCompression";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  FinanceEmptyState,
  FinanceErrorState,
  FinanceLoadingState,
  FinanceModal,
  FinanceModalFooter,
  FinancePageHeader,
  FinancePanel,
  FinancePrimaryAction,
  FinanceRecordCard,
  FinanceToolbar,
  financePageClass,
} from "../../components/finance/FinanceUi";
import {
  formatFinanceDate,
  formatFinanceMoneyMinor,
  getFinanceErrorMessage,
  humanizeFinanceValue,
} from "../../components/finance/financeFormatters";
import { InlineVendorSelect } from "../../components/finance/InlineVendorSelect";
import {
  useCreateVolunteerFundSpend,
  useVolunteerFunds,
} from "../../api/volunteerFunds";
import {
  applyDefaultTransactionAccount,
  applyTransactionAccountSelection,
  findDefaultCashPlnAccount,
  selectManualTransactionAccounts,
} from "./financeTransactionDefaults";
import {
  buildPaidBySelectionChange,
  hasManualPaymentStateChanged,
  isManualExpenseStatus,
  readTransactionPaidByUserId,
  validateManualExpensePayment,
  writeTransactionPaidByUserId,
} from "./financeTransactionPayment";
import InlineCategorySelect from "./InlineCategorySelect";
import { getInlineParentCategoryOptions } from "./inlineCategoryCreate";
import {
  buildFinanceTransactionDraftStorageKey,
  parseFinanceTransactionModalSearchParams,
  readFinanceTransactionDraft,
  removeFinanceTransactionDraft,
  serializeFinanceTransactionModalSearchParams,
  writeFinanceTransactionDraft,
  type FinanceTransactionActiveModalState,
  type FinanceTransactionDraft,
  type FinanceTransactionModalState,
} from "./financeTransactionModalPersistence";
import {
  activeVolunteerFundLinkedAccountIds,
  createVolunteerFundSpendIdempotencyKey,
  isVolunteerFundManagedTransactionMeta,
  resolveActiveVolunteerFundAccount,
  transferTouchesActiveVolunteerFund,
} from "./financeVolunteerFundTransaction";
import classes from "./FinanceTransactions.module.css";

const TRANSACTION_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "approved", label: "Approved" },
  { value: "awaiting_reimbursement", label: "Awaiting reimbursement" },
  { value: "paid", label: "Paid" },
  { value: "reimbursed", label: "Reimbursed" },
  { value: "void", label: "Void" },
] as const;

const TRANSACTION_KIND_OPTIONS = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Transfer" },
  { value: "refund", label: "Refund" },
];

const CREATE_TRANSACTION_KIND_OPTIONS = [
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Transfer" },
];

const TRANSACTION_PAGE_SIZE = 100;

const getStatusBadgeColor = (status: string): string => {
  switch (status) {
    case "planned":
      return "gray";
    case "approved":
      return "blue";
    case "awaiting_reimbursement":
      return "orange";
    case "paid":
      return "cyan";
    case "reimbursed":
      return "teal";
    case "void":
      return "red";
    default:
      return "blue";
  }
};

const getKindColor = (kind: FinanceTransaction["kind"]): string => {
  if (kind === "income" || kind === "refund") {
    return "teal";
  }
  if (kind === "expense") {
    return "orange";
  }
  return "blue";
};

const extractActionError = (error: unknown, fallback: string): string =>
  getFinanceErrorMessage(error, fallback);

type TransactionDraft = FinanceTransactionDraft;

const toFinanceTransactionChanges = (draft: TransactionDraft): Partial<FinanceTransaction> => ({
  kind: draft.kind,
  date: draft.date,
  accountId: draft.accountId ?? undefined,
  currency: draft.currency,
  amountMinor: draft.amountMinor,
  fxRate: draft.fxRate.toString(),
  categoryId: draft.categoryId,
  counterpartyType: draft.counterpartyType,
  counterpartyId: draft.counterpartyId,
  status: draft.status,
  description: draft.description,
  invoiceFileId: draft.invoiceFileId,
  meta: draft.meta ?? null,
});

const createDefaultDraft = (
  defaultAccount?: { id: number; currency: string } | null,
): TransactionDraft => ({
  kind: "expense",
  date: dayjs().format("YYYY-MM-DD"),
  accountId: defaultAccount?.id ?? null,
  targetAccountId: null,
  currency: defaultAccount?.currency.trim().toUpperCase() || "PLN",
  amountMinor: 0,
  fxRate: 1,
  categoryId: null,
  counterpartyType: "vendor",
  counterpartyId: null,
  status: "paid",
  description: null,
  invoiceFileId: null,
  meta: null,
});

const createDraftFromTransaction = (transaction: FinanceTransaction): TransactionDraft => {
  const meta = transaction.meta && typeof transaction.meta === "object"
    ? transaction.meta as Record<string, unknown>
    : null;
  const rawTargetAccountId = meta?.targetAccountId;
  return {
    kind: transaction.kind,
    date: transaction.date,
    accountId: transaction.accountId,
    targetAccountId: typeof rawTargetAccountId === "number" && rawTargetAccountId > 0
      ? rawTargetAccountId
      : null,
    currency: transaction.currency,
    amountMinor: transaction.amountMinor,
    fxRate: Number(transaction.fxRate),
    categoryId: transaction.categoryId,
    counterpartyType: transaction.counterpartyType,
    counterpartyId: transaction.counterpartyId,
    status: transaction.status,
    description: transaction.description,
    invoiceFileId: transaction.invoiceFileId,
    meta,
  };
};

const getBrowserLocalStorage = (): Storage | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch (_error) {
    return null;
  }
};

class ProtectedFinanceTransactionEditError extends Error {}

const getRequestStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }
  const status = Number((error as { status?: unknown }).status);
  return Number.isSafeInteger(status) && status > 0 ? status : null;
};

const FinanceTransactions = () => {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const transactionAccess = useModuleAccess(PAGE_SLUGS.financeTransactions);
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const transactions = useAppSelector(selectFinanceTransactions);
  const files = useAppSelector(selectFinanceFiles);
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const staffProfileState = useAppSelector((state) => state.staffProfiles[0]);
  const transactionModalState = useMemo(
    () => parseFinanceTransactionModalSearchParams(new URLSearchParams(location.search)),
    [location.search],
  );
  const activeTransactionModalState: FinanceTransactionActiveModalState | null =
    transactionModalState.mode === "closed" ? null : transactionModalState;
  const staffProfiles = useMemo(
    () =>
      ((staffProfileState.data[0]?.data as Partial<StaffProfile>[] | undefined) ?? []) as Partial<StaffProfile>[],
    [staffProfileState.data],
  );
  const defaultCashPlnAccount = useMemo(
    () => findDefaultCashPlnAccount(accounts.data),
    [accounts.data],
  );

  const [filters, setFilters] = useState<{ status?: string; kind?: string; accountId?: number | null }>({});
  const [appliedFilters, setAppliedFilters] = useState<{
    status?: string;
    kind?: string;
    accountId?: number | null;
  }>({});
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [inlineCreateModalOpen, setInlineCreateModalOpen] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft>(() => createDefaultDraft(defaultCashPlnAccount));
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [modalRouteLoading, setModalRouteLoading] = useState(false);
  const [modalRouteError, setModalRouteError] = useState<string | null>(null);
  const [modalAccessError, setModalAccessError] = useState<string | null>(null);
  const [modalRouteRetryToken, setModalRouteRetryToken] = useState(0);
  const [hydratedDraftStorageKey, setHydratedDraftStorageKey] = useState<string | null>(null);
  const [volunteerFundSpendIdempotencyKey, setVolunteerFundSpendIdempotencyKey] = useState(
    createVolunteerFundSpendIdempotencyKey,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modalHistoryEntryRef = useRef(false);
  const defaultCashPlnAccountRef = useRef(defaultCashPlnAccount);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const volunteerFundsQuery = useVolunteerFunds({
    enabled: modalOpen || transactionModalState.mode !== "closed",
  });
  const createVolunteerFundSpend = useCreateVolunteerFundSpend();
  const volunteerFunds = useMemo(
    () => volunteerFundsQuery.data?.funds ?? [],
    [volunteerFundsQuery.data?.funds],
  );
  const volunteerFundLinkedAccountIds = useMemo(
    () => activeVolunteerFundLinkedAccountIds(volunteerFunds),
    [volunteerFunds],
  );
  const manualTransactionAccounts = useMemo(
    () => selectManualTransactionAccounts(accounts.data, volunteerFundLinkedAccountIds),
    [accounts.data, volunteerFundLinkedAccountIds],
  );
  const vendorDefaultCategoryOptions = useMemo(
    () => getInlineParentCategoryOptions(categories.data, "expense").map(({ value, label }) => ({
      value,
      label,
    })),
    [categories.data],
  );

  useEffect(() => {
    defaultCashPlnAccountRef.current = defaultCashPlnAccount;
  }, [defaultCashPlnAccount]);

  const navigateTransactionModal = useCallback((
    nextState: FinanceTransactionModalState,
    replace: boolean,
  ) => {
    const nextParams = serializeFinanceTransactionModalSearchParams(
      new URLSearchParams(location.search),
      nextState,
    );
    const query = nextParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: query ? `?${query}` : "",
        hash: location.hash,
      },
      { replace, state: null },
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  const removeStoredDraft = useCallback((state: FinanceTransactionActiveModalState | null) => {
    const storage = getBrowserLocalStorage();
    if (storage && state && loggedUserId > 0) {
      removeFinanceTransactionDraft(storage, loggedUserId, state);
    }
  }, [loggedUserId]);

  const openCreateModal = useCallback(() => {
    if (!transactionAccess.ready || !transactionAccess.canCreate) {
      setModalAccessError(
        transactionAccess.ready
          ? "You do not have permission to create finance transactions."
          : "Your finance permissions are still loading. Try again in a moment.",
      );
      return;
    }
    modalHistoryEntryRef.current = true;
    setModalAccessError(null);
    setModalRouteError(null);
    navigateTransactionModal({ mode: "create", transactionId: null }, false);
  }, [navigateTransactionModal, transactionAccess.canCreate, transactionAccess.ready]);

  const openEditModal = useCallback((transactionId: number) => {
    modalHistoryEntryRef.current = true;
    setModalRouteError(null);
    navigateTransactionModal({ mode: "edit", transactionId }, false);
  }, [navigateTransactionModal]);

  const closeModal = () => {
    if (saving || uploadingInvoice) {
      return;
    }
    removeStoredDraft(activeTransactionModalState);
    setModalOpen(false);
    setInlineCreateModalOpen(false);
    setEditingTransaction(null);
    setHydratedDraftStorageKey(null);
    setSaveError(null);
    setUploadError(null);
    if (modalHistoryEntryRef.current) {
      modalHistoryEntryRef.current = false;
      navigate(-1);
      return;
    }
    navigateTransactionModal({ mode: "closed", transactionId: null }, true);
  };

  useEffect(() => {
    const routeState = location.state as { create?: boolean } | null;
    if (!routeState?.create) {
      return;
    }
    if (!transactionAccess.ready) {
      return;
    }
    if (!transactionAccess.canCreate) {
      setModalAccessError("You do not have permission to create finance transactions.");
      navigateTransactionModal({ mode: "closed", transactionId: null }, true);
      return;
    }
    setModalAccessError(null);
    navigateTransactionModal({ mode: "create", transactionId: null }, true);
  }, [
    location.state,
    navigateTransactionModal,
    transactionAccess.canCreate,
    transactionAccess.ready,
  ]);

  useEffect(() => {
    void dispatch(fetchFinanceAccounts());
    void dispatch(fetchFinanceCategories());
    void dispatch(fetchFinanceVendors());
    void dispatch(fetchFinanceClients());
    void dispatch(fetchFinanceTransactions({ limit: TRANSACTION_PAGE_SIZE, offset: 0 }));
    void dispatch(fetchStaffProfiles());
  }, [dispatch]);

  useEffect(() => {
    const currentParams = new URLSearchParams(location.search);
    const hasModalParams = currentParams.has("transactionModal")
      || currentParams.has("transactionId");

    if (transactionModalState.mode === "closed") {
      if (hasModalParams) {
        navigateTransactionModal({ mode: "closed", transactionId: null }, true);
        return;
      }
      setModalOpen(false);
      setInlineCreateModalOpen(false);
      setEditingTransaction(null);
      setHydratedDraftStorageKey(null);
      setModalRouteLoading(false);
      modalHistoryEntryRef.current = false;
      return;
    }

    if (transactionModalState.mode === "create" && !transactionAccess.ready) {
      setModalRouteLoading(true);
      return;
    }

    if (transactionModalState.mode === "create" && !transactionAccess.canCreate) {
      setModalOpen(false);
      setInlineCreateModalOpen(false);
      setEditingTransaction(null);
      setHydratedDraftStorageKey(null);
      setModalRouteLoading(false);
      setModalAccessError("You do not have permission to create finance transactions.");
      modalHistoryEntryRef.current = false;
      navigateTransactionModal({ mode: "closed", transactionId: null }, true);
      return;
    }

    if (transactionModalState.mode === "create") {
      setModalAccessError(null);
    }

    if (!Number.isSafeInteger(loggedUserId) || loggedUserId <= 0) {
      return;
    }

    const activeState = transactionModalState;
    const storageKey = buildFinanceTransactionDraftStorageKey(loggedUserId, activeState);
    if (!storageKey || hydratedDraftStorageKey === storageKey) {
      return;
    }

    const storage = getBrowserLocalStorage();
    let cancelled = false;
    setHydratedDraftStorageKey(null);
    setSaveError(null);
    setUploadError(null);
    setInlineCreateModalOpen(false);
    setModalRouteError(null);

    if (activeState.mode === "create") {
      const restored = storage
        ? readFinanceTransactionDraft(storage, loggedUserId, activeState)
        : null;
      setEditingTransaction(null);
      setDraft(restored?.draft ?? createDefaultDraft(defaultCashPlnAccountRef.current));
      setVolunteerFundSpendIdempotencyKey(
        restored?.volunteerFundSpendIdempotencyKey
        ?? createVolunteerFundSpendIdempotencyKey(),
      );
      setModalOpen(true);
      setModalRouteLoading(false);
      setHydratedDraftStorageKey(storageKey);
      return;
    }

    setModalOpen(false);
    setModalRouteLoading(true);
    const hydrateEdit = async () => {
      try {
        const transaction = await dispatch(
          fetchFinanceTransactionById(activeState.transactionId),
        ).unwrap();
        if (cancelled) {
          return;
        }
        if (
          transaction.kind === "transfer"
          || isVolunteerFundManagedTransactionMeta(transaction.meta)
        ) {
          throw new ProtectedFinanceTransactionEditError(
            "This transaction is managed by a protected workflow and cannot be edited here.",
          );
        }

        let restored = storage
          ? readFinanceTransactionDraft(storage, loggedUserId, activeState)
          : null;
        if (restored) {
          const serverUpdatedAt = Date.parse(transaction.updatedAt ?? transaction.createdAt);
          const draftUpdatedAt = Date.parse(restored.updatedAt);
          if (
            Number.isFinite(serverUpdatedAt)
            && Number.isFinite(draftUpdatedAt)
            && serverUpdatedAt > draftUpdatedAt
          ) {
            removeFinanceTransactionDraft(storage!, loggedUserId, activeState);
            restored = null;
            setModalRouteError(
              "A newer version of this transaction was found, so the older local draft was not restored.",
            );
          }
        }

        setEditingTransaction(transaction);
        setDraft(restored?.draft ?? createDraftFromTransaction(transaction));
        setVolunteerFundSpendIdempotencyKey(createVolunteerFundSpendIdempotencyKey());
        setModalOpen(true);
        setModalRouteLoading(false);
        setHydratedDraftStorageKey(storageKey);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const isTerminalError = error instanceof ProtectedFinanceTransactionEditError
          || getRequestStatus(error) === 404;
        if (storage && isTerminalError) {
          removeFinanceTransactionDraft(storage, loggedUserId, activeState);
        }
        setModalOpen(false);
        setEditingTransaction(null);
        setModalRouteLoading(false);
        setHydratedDraftStorageKey(null);
        setModalRouteError(extractActionError(error, "Unable to open this transaction."));
        if (isTerminalError) {
          modalHistoryEntryRef.current = false;
          navigateTransactionModal({ mode: "closed", transactionId: null }, true);
        }
      }
    };
    void hydrateEdit();

    return () => {
      cancelled = true;
    };
  }, [
    dispatch,
    hydratedDraftStorageKey,
    location.search,
    loggedUserId,
    modalRouteRetryToken,
    navigateTransactionModal,
    transactionAccess.canCreate,
    transactionAccess.ready,
    transactionModalState,
  ]);

  useEffect(() => {
    if (!modalOpen || !activeTransactionModalState || loggedUserId <= 0) {
      return;
    }
    const storageKey = buildFinanceTransactionDraftStorageKey(
      loggedUserId,
      activeTransactionModalState,
    );
    if (!storageKey || storageKey !== hydratedDraftStorageKey) {
      return;
    }
    const storage = getBrowserLocalStorage();
    if (!storage) {
      return;
    }
    writeFinanceTransactionDraft(
      storage,
      loggedUserId,
      activeTransactionModalState,
      draft,
      activeTransactionModalState.mode === "create"
        ? volunteerFundSpendIdempotencyKey
        : null,
    );
  }, [
    activeTransactionModalState,
    draft,
    hydratedDraftStorageKey,
    loggedUserId,
    modalOpen,
    volunteerFundSpendIdempotencyKey,
  ]);

  useEffect(() => {
    if (!modalOpen || editingTransaction || draft.accountId || !defaultCashPlnAccount) {
      return;
    }
    setDraft((state) => applyDefaultTransactionAccount(state, defaultCashPlnAccount));
  }, [defaultCashPlnAccount, draft.accountId, editingTransaction, modalOpen]);

  const staffNameById = useMemo(() => {
    const map = new Map<number, string>();
    staffProfiles.forEach((profile) => {
      if (typeof profile.userId === "number") {
        const rawName = (profile.userName ?? "").trim();
        map.set(profile.userId, rawName.length > 0 ? rawName : `User #${profile.userId}`);
      }
    });
    return map;
  }, [staffProfiles]);

  const transactionRows = useMemo(() => {
    const getSignedAmount = (transaction: FinanceTransaction): number => {
      const magnitude = Math.abs(transaction.amountMinor);
      if (transaction.kind === "transfer") {
        const direction =
          typeof transaction.meta === "object" && transaction.meta && typeof transaction.meta.direction === "string"
            ? (transaction.meta.direction as string)
            : null;
        return direction === "in" ? magnitude : -magnitude;
      }
      if (transaction.kind === "income" || transaction.kind === "refund") {
        return magnitude;
      }
      return -magnitude;
    };

    return transactions.data.map((transaction) => {
      const account = accounts.data.find((item) => item.id === transaction.accountId);
      const category = categories.data.find((item) => item.id === transaction.categoryId);
      const counterparty =
        transaction.counterpartyType === "vendor"
          ? vendors.data.find((item) => item.id === transaction.counterpartyId)?.name
          : transaction.counterpartyType === "client"
            ? clients.data.find((item) => item.id === transaction.counterpartyId)?.name
            : null;
      const paidByUserId = readTransactionPaidByUserId(transaction.meta);
      const paidByName = paidByUserId ? staffNameById.get(paidByUserId) ?? `User #${paidByUserId}` : "Company";
      return {
        ...transaction,
        accountName: account?.name ?? "Unknown account",
        categoryName: category?.name ?? "Uncategorized",
        counterpartyName: counterparty ?? "No counterparty",
        signedAmountMinor: getSignedAmount(transaction),
        paidByName,
      };
    });
  }, [transactions.data, accounts.data, categories.data, vendors.data, clients.data, staffNameById]);

  const visibleTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return transactionRows;
    }
    return transactionRows.filter((transaction) =>
      [
        transaction.id,
        transaction.kind,
        transaction.accountName,
        transaction.categoryName,
        transaction.counterpartyName,
        transaction.paidByName,
        transaction.status,
        transaction.description,
        transaction.currency,
      ].some((value) => String(value ?? "").toLowerCase().includes(query)),
    );
  }, [search, transactionRows]);

  const selectedVolunteerFundResolution = useMemo(
    () => resolveActiveVolunteerFundAccount(volunteerFunds, draft.accountId),
    [draft.accountId, volunteerFunds],
  );
  const selectedVolunteerFund = selectedVolunteerFundResolution.status === "matched"
    ? selectedVolunteerFundResolution.fund
    : null;
  const isCreatingVolunteerFundSpend = Boolean(
    !editingTransaction
    && draft.kind === "expense"
    && selectedVolunteerFund,
  );
  const configuredVolunteerFundCategory = useMemo(() => {
    if (!selectedVolunteerFund?.expenseCategoryId) {
      return null;
    }
    return categories.data.find(({ id }) => id === selectedVolunteerFund.expenseCategoryId) ?? null;
  }, [categories.data, selectedVolunteerFund]);
  const volunteerFundCategoryIssue = useMemo(() => {
    if (!selectedVolunteerFund) {
      return null;
    }
    if (!selectedVolunteerFund.expenseCategoryId) {
      return null;
    }
    if (!configuredVolunteerFundCategory) {
      return `The expense category configured for ${selectedVolunteerFund.name} could not be found.`;
    }
    if (!configuredVolunteerFundCategory.isActive || configuredVolunteerFundCategory.kind !== "expense") {
      return `The expense category configured for ${selectedVolunteerFund.name} is not an active expense category.`;
    }
    return null;
  }, [configuredVolunteerFundCategory, selectedVolunteerFund]);
  const transferUsesVolunteerFund = Boolean(
    !editingTransaction
    && draft.kind === "transfer"
    && transferTouchesActiveVolunteerFund(
      volunteerFunds,
      draft.accountId,
      draft.targetAccountId,
    ),
  );

  useEffect(() => {
    if (!isCreatingVolunteerFundSpend || !selectedVolunteerFund) {
      return;
    }
    setDraft((state) => ({
      ...state,
      categoryId: selectedVolunteerFund.expenseCategoryId ?? state.categoryId,
      status: "paid",
      meta: writeTransactionPaidByUserId(state.meta, null),
    }));
  }, [isCreatingVolunteerFundSpend, selectedVolunteerFund]);

  const handleApplyFilters = () => {
    const nextFilters = { ...filters };
    setAppliedFilters(nextFilters);
    void dispatch(
      fetchFinanceTransactions({
        status: nextFilters.status,
        kind: nextFilters.kind,
        accountId: nextFilters.accountId ?? undefined,
        limit: TRANSACTION_PAGE_SIZE,
        offset: 0,
      }),
    );
  };

  const handleClearFilters = () => {
    setFilters({});
    setAppliedFilters({});
    setSearch("");
    void dispatch(fetchFinanceTransactions({ limit: TRANSACTION_PAGE_SIZE, offset: 0 }));
  };

  const handlePageChange = (page: number) => {
    const offset = (page - 1) * TRANSACTION_PAGE_SIZE;
    void dispatch(
      fetchFinanceTransactions({
        status: appliedFilters.status,
        kind: appliedFilters.kind,
        accountId: appliedFilters.accountId ?? undefined,
        limit: TRANSACTION_PAGE_SIZE,
        offset,
      }),
    );
  };

  const handleSubmit = async () => {
    setSaveError(null);
    if (!editingTransaction && (!transactionAccess.ready || !transactionAccess.canCreate)) {
      setSaveError("You do not have permission to create finance transactions.");
      return;
    }
    if (!draft.accountId || !draft.date || !draft.currency.trim()) {
      setSaveError("Date, account, and currency are required.");
      return;
    }
    if (draft.amountMinor <= 0) {
      setSaveError("Amount must be greater than zero.");
      return;
    }
    if (!editingTransaction && volunteerFundsQuery.isFetching) {
      setSaveError("Volunteer Fund routing is still being checked. Try again in a moment.");
      return;
    }
    if (!editingTransaction && volunteerFundsQuery.isError) {
      setSaveError("Volunteer Fund routing could not be verified. Reload the fund configuration before saving.");
      return;
    }
    const selectedAccount = accounts.data.find((account) => account.id === draft.accountId);
    if (!selectedAccount) {
      setSaveError("Select a valid finance account.");
      return;
    }
    const keepsHistoricalAccount = Boolean(
      editingTransaction && editingTransaction.accountId === selectedAccount.id,
    );
    if (!keepsHistoricalAccount && !manualTransactionAccounts.some((account) => account.id === selectedAccount.id)) {
      setSaveError("Select Cash Register PLN, Cash Register EUR, Dave, or Volunteer Fund.");
      return;
    }
    if (!editingTransaction && selectedVolunteerFundResolution.status === "ambiguous") {
      setSaveError(
        "This account is linked to more than one active Volunteer Fund. Fix the fund configuration before recording activity.",
      );
      return;
    }
    const accountCurrency = selectedAccount.currency.trim().toUpperCase();
    if (draft.currency.trim().toUpperCase() !== accountCurrency) {
      setSaveError(
        `This transaction is saved as ${draft.currency.trim().toUpperCase()}, but ${selectedAccount.name} uses ${accountCurrency}. Currency mismatches cannot be saved.`,
      );
      return;
    }
    if (editingTransaction?.kind === "transfer") {
      setSaveError("Paired transfer records are view-only. Create a correcting transfer instead.");
      return;
    }
    if (editingTransaction && draft.kind === "transfer") {
      setSaveError("Existing transactions cannot be converted into transfers. Create a new transfer instead.");
      return;
    }
    if (draft.kind === "transfer" && !draft.targetAccountId) {
      setSaveError("Select the target account for this transfer.");
      return;
    }
    if (draft.kind === "transfer" && transferUsesVolunteerFund) {
      setSaveError(
        "Volunteer Fund accounts cannot be used in an ordinary transfer. Use the Volunteer Funds or Staff Payments workflow so both ledgers remain synchronized.",
      );
      return;
    }
    if (draft.kind === "transfer" && draft.targetAccountId) {
      if (draft.targetAccountId === draft.accountId) {
        setSaveError("The source and target accounts must be different.");
        return;
      }
      const targetAccount = accounts.data.find((account) => account.id === draft.targetAccountId);
      if (!targetAccount) {
        setSaveError("Select a valid target account.");
        return;
      }
      if (!manualTransactionAccounts.some((account) => account.id === targetAccount.id)) {
        setSaveError("Select Cash Register PLN, Cash Register EUR, Dave, or Volunteer Fund as the target account.");
        return;
      }
      const targetCurrency = targetAccount.currency.trim().toUpperCase();
      if (targetCurrency !== accountCurrency) {
        setSaveError(
          `Cross-currency transfers are not available yet. Choose another ${accountCurrency} account or record the conversion as separate transactions.`,
        );
        return;
      }
    }
    if (draft.kind === "expense") {
      const vendorExists = vendors.data.some((vendor) => (
        vendor.id === draft.counterpartyId
        && (!isCreatingVolunteerFundSpend || vendor.isActive)
      ));
      if (draft.counterpartyType !== "vendor" || !vendorExists) {
        setSaveError(
          isCreatingVolunteerFundSpend
            ? "Select an active vendor for this Volunteer Fund spend."
            : "Select a vendor for this expense.",
        );
        return;
      }
      if (isCreatingVolunteerFundSpend && selectedVolunteerFund) {
        if (!draft.description?.trim()) {
          setSaveError("Add a description for the Volunteer Fund audit trail.");
          return;
        }
        if (volunteerFundCategoryIssue) {
          setSaveError(
            volunteerFundCategoryIssue,
          );
          return;
        }
        if (!draft.categoryId) {
          setSaveError("Select an active expense category for this Volunteer Fund spend.");
          return;
        }
        const selectedFundCategory = categories.data.find(({ id }) => id === draft.categoryId);
        if (
          !selectedFundCategory
          || !selectedFundCategory.isActive
          || selectedFundCategory.kind !== "expense"
        ) {
          setSaveError("Select an active expense category for this Volunteer Fund spend.");
          return;
        }
        if (
          selectedVolunteerFund.expenseCategoryId
          && draft.categoryId !== selectedVolunteerFund.expenseCategoryId
        ) {
          setSaveError("This spend must use the expense category configured for the Volunteer Fund.");
          return;
        }
        if (draft.amountMinor > selectedVolunteerFund.balanceMinor) {
          setSaveError(
            `This spend exceeds the available Volunteer Fund balance of ${formatFinanceMoneyMinor(
              selectedVolunteerFund.balanceMinor,
              selectedVolunteerFund.currency,
            )}.`,
          );
          return;
        }
      } else if (isManualExpenseStatus(draft.status)) {
        const paidByUserId = readTransactionPaidByUserId(draft.meta);
        const originalPaidByUserId = editingTransaction
          ? readTransactionPaidByUserId(editingTransaction.meta)
          : null;
        const shouldValidatePayment = !editingTransaction || hasManualPaymentStateChanged(
          draft.status,
          paidByUserId,
          editingTransaction.status,
          originalPaidByUserId,
        );
        if (shouldValidatePayment) {
          const paymentError = validateManualExpensePayment(
            draft.status,
            paidByUserId,
            Boolean(paidByUserId && staffProfiles.some((profile) => profile.userId === paidByUserId)),
          );
          if (paymentError) {
            setSaveError(paymentError);
            return;
          }
        }
      }
    }
    if (draft.kind === "income") {
      const clientExists = clients.data.some((client) => client.id === draft.counterpartyId);
      if (draft.counterpartyType !== "client" || !clientExists) {
        setSaveError("Select a client for this income.");
        return;
      }
    }
    if (draft.categoryId) {
      const selectedCategory = categories.data.find((category) => category.id === draft.categoryId);
      const expectedCategoryKind = draft.kind === "expense"
        ? "expense"
        : draft.kind === "income" || draft.kind === "refund"
          ? "income"
          : null;
      if (!selectedCategory || selectedCategory.kind !== expectedCategoryKind) {
        setSaveError("Select a category that matches the transaction kind.");
        return;
      }
    }

    const commonPayload = toFinanceTransactionChanges({ ...draft, accountId: draft.accountId });
    try {
      setSaving(true);
      if (editingTransaction) {
        await dispatch(
          updateFinanceTransaction({
            id: editingTransaction.id,
            changes: commonPayload,
          }),
        ).unwrap();
      } else if (
        isCreatingVolunteerFundSpend
        && selectedVolunteerFund
        && draft.accountId
        && draft.categoryId
        && draft.counterpartyId
        && draft.description?.trim()
      ) {
        await createVolunteerFundSpend.mutateAsync({
          fundId: selectedVolunteerFund.id,
          payload: {
            entryDate: draft.date,
            amountMinor: draft.amountMinor,
            description: draft.description.trim(),
            accountId: draft.accountId,
            categoryId: draft.categoryId,
            vendorId: draft.counterpartyId,
            invoiceFileId: draft.invoiceFileId,
            idempotencyKey: volunteerFundSpendIdempotencyKey,
          },
        });
      } else if (draft.kind === "transfer" && draft.targetAccountId && draft.accountId) {
        await dispatch(
          createFinanceTransfer({
            fromAccountId: draft.accountId,
            toAccountId: draft.targetAccountId,
            amountMinor: draft.amountMinor,
            currency: draft.currency,
            fxRate: draft.fxRate,
            description: draft.description ?? undefined,
            status: "paid",
            date: draft.date,
          }),
        ).unwrap();
      } else {
        await dispatch(createFinanceTransaction(commonPayload)).unwrap();
      }

      removeStoredDraft(activeTransactionModalState);
      setModalOpen(false);
      setInlineCreateModalOpen(false);
      setEditingTransaction(null);
      setHydratedDraftStorageKey(null);
      setDraft(createDefaultDraft(defaultCashPlnAccount));
      setFilters({ ...appliedFilters });
      setSearch("");
      modalHistoryEntryRef.current = false;
      navigateTransactionModal({ mode: "closed", transactionId: null }, true);

      await dispatch(
        fetchFinanceTransactions({
          status: appliedFilters.status,
          kind: appliedFilters.kind,
          accountId: appliedFilters.accountId ?? undefined,
          limit: TRANSACTION_PAGE_SIZE,
          offset: 0,
        }),
      );
    } catch (error) {
      setSaveError(extractActionError(error, "Unable to save this transaction."));
    } finally {
      setSaving(false);
    }
  };

  const counterpartyOptions =
    draft.kind === "expense"
      ? vendors.data
        .filter((vendor) => !isCreatingVolunteerFundSpend || vendor.isActive)
        .map((vendor) => ({ value: String(vendor.id), label: vendor.name }))
      : draft.kind === "income"
        ? clients.data.map((client) => ({ value: String(client.id), label: client.name }))
        : [];

  const filterAccountOptions = accounts.data
    .map((account) => ({
      value: String(account.id),
      label: `${account.name} (${account.currency})`,
    }));

  const editingAccount = editingTransaction
    ? accounts.data.find((account) => account.id === editingTransaction.accountId) ?? null
    : null;
  const modalAccountOptions: Array<{ value: string; label: string; disabled?: boolean }> = manualTransactionAccounts.map((account) => {
    const transferRestricted = Boolean(
      !editingTransaction
      && draft.kind === "transfer"
      && volunteerFundLinkedAccountIds.has(account.id),
    );
    return {
      value: String(account.id),
      label: `${account.name} (${account.currency})${transferRestricted ? " - managed through Volunteer Funds" : ""}`,
      disabled: transferRestricted,
    };
  });
  if (
    editingAccount
    && draft.accountId === editingAccount.id
    && !manualTransactionAccounts.some((account) => account.id === editingAccount.id)
  ) {
    modalAccountOptions.push({
      value: String(editingAccount.id),
      label: `${editingAccount.name} (${editingAccount.currency}) - Historical account`,
      disabled: true,
    });
  }

  const selectedDraftAccount = accounts.data.find((account) => account.id === draft.accountId) ?? null;
  const selectedDraftTargetAccount =
    accounts.data.find((account) => account.id === draft.targetAccountId) ?? null;
  const selectedAccountCurrency = selectedDraftAccount?.currency.trim().toUpperCase() ?? null;
  const accountCurrencyMismatch = Boolean(
    selectedDraftAccount
      && draft.currency.trim().toUpperCase() !== selectedAccountCurrency,
  );
  const transferCurrencyMismatch = Boolean(
    draft.kind === "transfer"
      && selectedDraftAccount
      && selectedDraftTargetAccount
      && selectedDraftTargetAccount.currency.trim().toUpperCase() !== selectedAccountCurrency,
  );
  const transferTargetOptions = manualTransactionAccounts
    .filter((account) => account.id !== draft.accountId)
    .map((account) => {
      const currency = account.currency.trim().toUpperCase();
      const volunteerFundRestricted = volunteerFundLinkedAccountIds.has(account.id);
      return {
        value: String(account.id),
        label: `${account.name} (${currency})${volunteerFundRestricted ? " - managed through Volunteer Funds" : ""}`,
        disabled: volunteerFundRestricted
          || Boolean(selectedAccountCurrency && currency !== selectedAccountCurrency),
      };
    });
  const volunteerFundSpendExceedsBalance = Boolean(
    isCreatingVolunteerFundSpend
    && selectedVolunteerFund
    && draft.amountMinor > selectedVolunteerFund.balanceMinor,
  );
  const volunteerFundSpendBlocked = Boolean(
    isCreatingVolunteerFundSpend
    && (
      volunteerFundCategoryIssue
      || !draft.categoryId
      || !draft.description?.trim()
      || volunteerFundSpendExceedsBalance
    ),
  );

  const paidByOptions = useMemo(
    () => [
      { value: "company", label: "Company Funds" },
      ...staffProfiles
        .filter((profile): profile is StaffProfile => typeof profile?.userId === "number")
        .map((profile) => ({
          value: String(profile.userId),
          label:
            typeof profile.userName === "string" && profile.userName.trim().length > 0
              ? profile.userName.trim()
              : `User #${profile.userId}`,
        })),
    ],
    [staffProfiles],
  );

  const paidByValue = useMemo(() => {
    const userId = readTransactionPaidByUserId(draft.meta);
    if (userId) {
      return String(userId);
    }
    return draft.status === "awaiting_reimbursement" ? null : "company";
  }, [draft.meta, draft.status]);

  const handlePaidByChange = useCallback((value: string | null) => {
    setDraft((state) => {
      const nextUserId = !value || value === "company" ? null : Number(value);
      return { ...state, ...buildPaidBySelectionChange(state.meta, nextUserId) };
    });
    setSaveError(null);
  }, []);

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const target = event.target;
    const file = target?.files?.[0];
    if (!file) {
      return;
    }
    setUploadError(null);
    setUploadingInvoice(true);
    setUploadProgress(0);
    let preparedFile: File = file;
    if (file.type?.startsWith("image/")) {
      try {
        preparedFile = await compressImageFile(file, {
          maxWidth: 1600,
          maxHeight: 1600,
          quality: 0.8,
          maxSizeBytes: 700 * 1024,
        });
      } catch (compressionError) {
        console.error("Failed to compress invoice before upload", compressionError);
      }
    }
    const formData = new FormData();
    formData.append("file", preparedFile);
    try {
      const result = await dispatch(
        uploadFinanceFile({
          formData,
          onUploadProgress: (percent) => setUploadProgress(percent),
        }),
      );
      if (uploadFinanceFile.fulfilled.match(result)) {
        setDraft((state) => ({ ...state, invoiceFileId: result.payload.id }));
      } else {
        setUploadError(result.error.message ?? "Failed to upload invoice");
      }
    } finally {
      setUploadingInvoice(false);
      setUploadProgress(0);
    }
    if (target) {
      target.value = "";
    }
  };

  const statusBadge = (transaction: FinanceTransaction) => (
    <Badge color={getStatusBadgeColor(transaction.status)} variant="light">
      {TRANSACTION_STATUS_OPTIONS.find((option) => option.value === transaction.status)?.label
        ?? humanizeFinanceValue(transaction.status)}
    </Badge>
  );

  const renderEditAction = (transaction: FinanceTransaction) => {
    const isTransfer = transaction.kind === "transfer";
    const isVolunteerFundManaged = isVolunteerFundManagedTransactionMeta(transaction.meta);
    const isReadOnly = isTransfer || isVolunteerFundManaged;
    const readOnlyReason = isVolunteerFundManaged
      ? "This transaction is managed by the Volunteer Fund ledger. Record corrections from Volunteer Funds."
      : "Transfers are paired records and cannot be edited here. Create a correcting transfer instead.";
    return (
      <Tooltip
        label={isReadOnly ? readOnlyReason : "Edit transaction"}
        multiline
        maw={280}
      >
        <span
          tabIndex={isReadOnly ? 0 : undefined}
          aria-label={isReadOnly ? "Managed finance transaction is view-only" : undefined}
        >
          <ActionIcon
            variant="light"
            color={isReadOnly ? "gray" : "blue"}
            disabled={isReadOnly}
            onClick={() => {
              if (isReadOnly) {
                return;
              }
              openEditModal(transaction.id);
            }}
            aria-label={
              isReadOnly
                ? `Managed transaction ${transaction.id} cannot be edited here`
                : `Edit transaction ${transaction.id}`
            }
          >
            {isReadOnly ? <IconLock size={18} /> : <IconEdit size={18} />}
          </ActionIcon>
        </span>
      </Tooltip>
    );
  };

  const pageLimit = transactions.meta.limit || TRANSACTION_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(transactions.meta.count / pageLimit));
  const currentPage = Math.floor(transactions.meta.offset / pageLimit) + 1;
  const firstRecord = transactions.meta.count === 0 ? 0 : transactions.meta.offset + 1;
  const lastRecord = Math.min(transactions.meta.offset + transactions.data.length, transactions.meta.count);

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        title="Transactions"
        description="Record income, expenses, transfers, and refunds with consistent finance classifications."
        icon={<IconArrowsExchange size={24} />}
        actions={
          transactionAccess.ready && transactionAccess.canCreate ? (
            <Group gap="sm" wrap="wrap">
              <Button
                component="a"
                href="/finance/new-transaction/install.html"
                target="_blank"
                rel="noopener"
                variant="default"
                leftSection={<IconDownload size={17} />}
              >
                Install transaction app
              </Button>
              <FinancePrimaryAction leftSection={<IconPlus size={18} />} onClick={openCreateModal}>
                New transaction
              </FinancePrimaryAction>
            </Group>
          ) : null
        }
      />

      {modalAccessError && (
        <Alert
          color="orange"
          variant="light"
          title="Cannot create transaction"
          withCloseButton
          onClose={() => setModalAccessError(null)}
        >
          {modalAccessError}
        </Alert>
      )}
      {modalRouteLoading && (
        <Alert color="blue" variant="light" title="Opening transaction">
          Loading the requested transaction…
        </Alert>
      )}
      {modalRouteError && !modalOpen && (
        <Alert
          color="orange"
          variant="light"
          title="Transaction draft notice"
          withCloseButton
          onClose={() => setModalRouteError(null)}
        >
          <Stack gap="xs">
            <Text size="sm">{modalRouteError}</Text>
            {transactionModalState.mode === "edit" && !modalOpen && (
              <Group justify="flex-start">
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => setModalRouteRetryToken((value) => value + 1)}
                >
                  Retry opening
                </Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search this loaded page"
      >
        <Select
          placeholder="All statuses"
          aria-label="Filter transactions by status"
          value={filters.status ?? null}
          onChange={(value) => setFilters((state) => ({ ...state, status: value ?? undefined }))}
          data={TRANSACTION_STATUS_OPTIONS}
          clearable
          style={{ flex: "1 1 170px", maxWidth: isMobile ? undefined : 205 }}
        />
        <Select
          placeholder="All kinds"
          aria-label="Filter transactions by kind"
          value={filters.kind ?? null}
          onChange={(value) => setFilters((state) => ({ ...state, kind: value ?? undefined }))}
          data={TRANSACTION_KIND_OPTIONS}
          clearable
          style={{ flex: "1 1 150px", maxWidth: isMobile ? undefined : 190 }}
        />
        <Select
          placeholder="All accounts"
          aria-label="Filter transactions by account"
          data={filterAccountOptions}
          value={filters.accountId ? String(filters.accountId) : null}
          onChange={(value) =>
            setFilters((state) => ({ ...state, accountId: value ? Number(value) : null }))
          }
          searchable
          clearable
          style={{ flex: "1 1 190px", maxWidth: isMobile ? undefined : 250 }}
        />
        <Button variant="light" onClick={handleApplyFilters} loading={transactions.loading}>
          Apply filters
        </Button>
        {(filters.status
          || filters.kind
          || filters.accountId
          || appliedFilters.status
          || appliedFilters.kind
          || appliedFilters.accountId
          || search) && (
          <Button variant="subtle" color="gray" onClick={handleClearFilters}>
            Clear
          </Button>
        )}
      </FinanceToolbar>

      <FinancePanel
        title="Transaction ledger"
        description={
          search.trim()
            ? `${visibleTransactions.length} matches on this page · records ${firstRecord}–${lastRecord} of ${transactions.meta.count}`
            : `Records ${firstRecord}–${lastRecord} of ${transactions.meta.count}`
        }
        noPadding
      >
        {transactions.error ? (
          <FinanceErrorState message={transactions.error} onRetry={handleApplyFilters} />
        ) : transactions.loading && transactionRows.length === 0 ? (
          <FinanceLoadingState label="Loading transactions" />
        ) : visibleTransactions.length === 0 ? (
          <FinanceEmptyState
            icon={<IconArrowsExchange size={25} />}
            title={transactionRows.length === 0 ? "No transactions yet" : "No matching transactions"}
            description={
              transactionRows.length === 0
                ? "Record the first income, expense, transfer, or refund to start the ledger."
                : "Try clearing a filter or using a broader search."
            }
            action={
              transactionRows.length === 0
                && transactionAccess.ready
                && transactionAccess.canCreate
                ? <Button onClick={openCreateModal}>Record transaction</Button>
                : undefined
            }
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {visibleTransactions.map((transaction) => (
              <FinanceRecordCard
                key={transaction.id}
                leading={
                  <ThemeIcon variant="light" color={getKindColor(transaction.kind)} radius="md">
                    <IconArrowsLeftRight size={17} />
                  </ThemeIcon>
                }
                title={formatFinanceMoneyMinor(transaction.signedAmountMinor, transaction.currency, { showSign: true })}
                subtitle={transaction.description || `${humanizeFinanceValue(transaction.kind)} · ${formatFinanceDate(transaction.date)}`}
                status={statusBadge(transaction)}
                fields={[
                  { label: "Account", value: transaction.accountName },
                  { label: "Category", value: transaction.categoryName },
                  { label: "Counterparty", value: transaction.counterpartyName },
                  { label: "Paid by", value: transaction.paidByName },
                ]}
                actions={renderEditAction(transaction)}
              />
            ))}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={1040}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Account</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Counterparty</Table.Th>
                  <Table.Th>Paid by</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleTransactions.map((transaction) => (
                  <Table.Tr key={transaction.id}>
                    <Table.Td>{formatFinanceDate(transaction.date)}</Table.Td>
                    <Table.Td>
                      <Badge color={getKindColor(transaction.kind)} variant="light">
                        {humanizeFinanceValue(transaction.kind)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{transaction.accountName}</Table.Td>
                    <Table.Td ta="right">
                      <Text fw={750} c={transaction.signedAmountMinor >= 0 ? "teal" : "red"}>
                        {formatFinanceMoneyMinor(transaction.signedAmountMinor, transaction.currency, { showSign: true })}
                      </Text>
                    </Table.Td>
                    <Table.Td>{transaction.categoryName}</Table.Td>
                    <Table.Td>{transaction.counterpartyName}</Table.Td>
                    <Table.Td>{transaction.paidByName}</Table.Td>
                    <Table.Td>{statusBadge(transaction)}</Table.Td>
                    <Table.Td ta="right">{renderEditAction(transaction)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </FinancePanel>

      {pageCount > 1 && (
        <Group justify="space-between" align="center" wrap="wrap">
          <Text size="sm" c="dimmed">
            Page {currentPage} of {pageCount}. Search only filters the currently loaded page.
          </Text>
          <Pagination
            value={currentPage}
            total={pageCount}
            onChange={handlePageChange}
            disabled={transactions.loading}
            withEdges
            aria-label="Transaction pages"
          />
        </Group>
      )}

      <FinanceModal
        opened={modalOpen}
        onClose={closeModal}
        title={editingTransaction
          ? `Edit ${humanizeFinanceValue(editingTransaction.kind).toLowerCase()} transaction`
          : "Record transaction"}
        size={940}
        scrollAreaComponent={ScrollArea.Autosize}
        closeOnClickOutside={!saving && !uploadingInvoice && !inlineCreateModalOpen}
        closeOnEscape={!saving && !uploadingInvoice && !inlineCreateModalOpen}
        styles={{ title: { width: "100%", textAlign: "center" } }}
      >
        <form
          key={hydratedDraftStorageKey ?? "closed-transaction-modal"}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Stack gap="md" className={classes.transactionForm}>
            {modalRouteError && (
              <Alert
                className={classes.formAlert}
                color="orange"
                variant="light"
                title="Local draft notice"
                withCloseButton
                onClose={() => setModalRouteError(null)}
              >
                {modalRouteError}
              </Alert>
            )}
            {!editingTransaction && (
              <Box className={classes.kindBlock}>
                <Text className={classes.compactTitle}>Transaction type</Text>
                <SegmentedControl
                  className={classes.kindControl}
                  fullWidth
                  aria-label="Transaction type"
                  data={CREATE_TRANSACTION_KIND_OPTIONS}
                  value={draft.kind}
                  onChange={(value) => {
                    const isTransfer = value === "transfer";
                    setSaveError(null);
                    setDraft((state) => ({
                      ...state,
                      kind: value as TransactionDraft["kind"],
                      accountId: isTransfer && state.accountId && volunteerFundLinkedAccountIds.has(state.accountId)
                        ? null
                        : state.accountId,
                      targetAccountId: isTransfer
                        && state.targetAccountId
                        && !volunteerFundLinkedAccountIds.has(state.targetAccountId)
                        ? state.targetAccountId
                        : null,
                      fxRate: isTransfer ? 1 : state.fxRate,
                      counterpartyType: value === "expense" ? "vendor" : "none",
                      counterpartyId: null,
                      categoryId: null,
                      status: "paid",
                      meta: value === "expense" ? state.meta : writeTransactionPaidByUserId(state.meta, null),
                    }));
                  }}
                />
              </Box>
            )}

            <Box className={classes.amountCard}>
              <NumberInput
                className={classes.amountInput}
                label="Amount"
                aria-label="Transaction amount"
                value={draft.amountMinor / 100}
                min={0}
                decimalScale={2}
                fixedDecimalScale
                hideControls
                autoFocus={!editingTransaction}
                rightSection={<Text className={classes.amountCurrency}>{draft.currency}</Text>}
                rightSectionWidth={58}
                onValueChange={({ value }) =>
                  setDraft((state) => ({ ...state, amountMinor: Math.round((Number(value) || 0) * 100) }))
                }
                withAsterisk
              />
            </Box>

            <SimpleGrid
              className={classes.formGrid}
              cols={{ base: 1, sm: draft.kind === "transfer" ? 3 : 2 }}
              spacing="sm"
            >
              <Select
                label={draft.kind === "transfer" ? "From account" : "Account"}
                data={modalAccountOptions}
                value={draft.accountId ? String(draft.accountId) : null}
                onChange={(value) => {
                  const account = accounts.data.find((item) => item.id === Number(value));
                  setSaveError(null);
                  setDraft((state) => applyTransactionAccountSelection(
                    state,
                    account ?? null,
                    accounts.data,
                  ));
                }}
                withAsterisk
                searchable
              />
              {draft.kind === "transfer" && (
                <Select
                  label="To account"
                  data={transferTargetOptions}
                  value={draft.targetAccountId ? String(draft.targetAccountId) : null}
                  onChange={(value) => {
                    setSaveError(null);
                    setDraft((state) => ({ ...state, targetAccountId: value ? Number(value) : null }));
                  }}
                  withAsterisk
                  searchable
                />
              )}
              <DateInput
                label="Date"
                value={dayjs(draft.date).toDate()}
                onChange={(value) => {
                  if (value) {
                    setDraft((state) => ({ ...state, date: dayjs(value).format("YYYY-MM-DD") }));
                  }
                }}
                valueFormat="DD MMM YYYY"
                withAsterisk
              />
            </SimpleGrid>

            {!editingTransaction && volunteerFundsQuery.isLoading && (
              <Alert className={classes.formAlert} color="blue" variant="light">
                Checking Volunteer Fund account routing…
              </Alert>
            )}

            {!editingTransaction && volunteerFundsQuery.isError && (
              <Alert className={classes.formAlert} color="red" title="Volunteer Fund routing unavailable">
                Fund configuration could not be loaded. Saving is paused so an ordinary transaction cannot bypass the fund ledger.
              </Alert>
            )}

            {!editingTransaction && selectedVolunteerFundResolution.status === "ambiguous" && (
              <Alert className={classes.formAlert} color="red" title="Duplicate Volunteer Fund link">
                This account is linked to {selectedVolunteerFundResolution.matches.length} active funds. Fix the fund configuration before recording activity.
              </Alert>
            )}

            {isCreatingVolunteerFundSpend && selectedVolunteerFund && (
              <Alert
                className={classes.fundContext}
                color={volunteerFundCategoryIssue || volunteerFundSpendExceedsBalance ? "red" : "violet"}
                icon={<IconWallet size={18} />}
                title={`${selectedVolunteerFund.name}`}
              >
                <Stack gap={5}>
                  <Group justify="center" gap="xs" wrap="wrap">
                    <Badge color="violet" variant="filled">
                      Available {formatFinanceMoneyMinor(
                        selectedVolunteerFund.balanceMinor,
                        selectedVolunteerFund.currency,
                      )}
                    </Badge>
                    {configuredVolunteerFundCategory && (
                      <Badge color="gray" variant="light">
                        Category: {configuredVolunteerFundCategory.name}
                      </Badge>
                    )}
                  </Group>
                  {volunteerFundCategoryIssue && (
                    <Text size="sm" fw={700} c="red.8" ta="center">
                      {volunteerFundCategoryIssue} Configure it on the Volunteer Funds page first.
                    </Text>
                  )}
                  {volunteerFundSpendExceedsBalance && (
                    <Text size="sm" fw={700} c="red.8" ta="center">
                      The entered amount is greater than the available balance.
                    </Text>
                  )}
                </Stack>
              </Alert>
            )}

            {!editingTransaction && draft.kind === "transfer" && volunteerFundLinkedAccountIds.size > 0 && (
              <Alert className={classes.formAlert} color="blue" variant="light" title="Volunteer Fund accounts are protected">
                Fund accounts are unavailable for ordinary transfers. Use Staff Payments for allocations or Volunteer Funds for controlled fund activity so both ledgers remain synchronized.
              </Alert>
            )}

            {editingTransaction
              && draft.kind !== "transfer"
              && (draft.kind !== "expense" || !isManualExpenseStatus(draft.status)) && (
                <Group justify="center">
                  <Badge color={getStatusBadgeColor(draft.status)} variant="light">
                    Historical status: {humanizeFinanceValue(draft.status)}
                  </Badge>
                </Group>
              )}

            {selectedAccountCurrency !== null
              && selectedAccountCurrency !== "PLN"
              && draft.kind !== "transfer" && (
                <NumberInput
                  label="FX rate"
                  decimalScale={4}
                  value={draft.fxRate}
                  min={0.0001}
                  hideControls
                  onValueChange={({ value }) =>
                    setDraft((state) => ({ ...state, fxRate: Number(value) || 1 }))
                  }
                  style={{ width: "min(100%, 260px)", margin: "0 auto" }}
                />
              )}

            {accountCurrencyMismatch && selectedDraftAccount && (
              <Alert className={classes.formAlert} color="orange">
                This record uses {draft.currency.trim().toUpperCase()}, while {selectedDraftAccount.name} uses {selectedAccountCurrency}.
                Saving is blocked; create a correcting transaction instead.
              </Alert>
            )}

            {draft.kind !== "transfer" && (
              <SimpleGrid
                className={classes.formGrid}
                cols={{
                  base: 1,
                  sm: draft.kind === "expense"
                    ? isCreatingVolunteerFundSpend ? 2 : 3
                    : draft.kind === "income" ? 2 : 1,
                }}
                spacing="sm"
                style={draft.kind === "refund"
                  ? { width: "min(100%, 320px)", margin: "0 auto" }
                  : undefined}
              >
                <InlineCategorySelect
                  categories={isCreatingVolunteerFundSpend
                    ? categories.data.filter(({ isActive }) => isActive)
                    : categories.data}
                  transactionKind={draft.kind}
                  value={draft.categoryId}
                  onChange={(categoryId) =>
                    setDraft((state) => ({ ...state, categoryId }))
                  }
                  onCreateModalOpenChange={setInlineCreateModalOpen}
                  disabled={saving || Boolean(
                    isCreatingVolunteerFundSpend && selectedVolunteerFund?.expenseCategoryId,
                  )}
                />
                {draft.kind === "expense" && (
                  <InlineVendorSelect
                    options={counterpartyOptions}
                    value={draft.counterpartyId ? String(draft.counterpartyId) : null}
                    onChange={(value) =>
                      setDraft((state) => ({
                        ...state,
                        counterpartyType: "vendor",
                        counterpartyId: value ? Number(value) : null,
                      }))
                    }
                    onCreateModalOpenChange={setInlineCreateModalOpen}
                    defaultCategoryId={draft.categoryId}
                    defaultCategoryOptions={vendorDefaultCategoryOptions}
                    disabled={saving}
                  />
                )}
                {draft.kind === "income" && (
                  <Select
                    label="Client"
                    data={counterpartyOptions}
                    value={draft.counterpartyId ? String(draft.counterpartyId) : null}
                    onChange={(value) =>
                      setDraft((state) => ({
                        ...state,
                        counterpartyType: "client",
                        counterpartyId: value ? Number(value) : null,
                      }))
                    }
                    searchable
                    withAsterisk
                  />
                )}
                {draft.kind === "expense" && !isCreatingVolunteerFundSpend && (
                  <Select
                    label="Paid by"
                    data={paidByOptions}
                    value={paidByValue}
                    onChange={handlePaidByChange}
                    placeholder="Select staff member"
                    searchable
                    allowDeselect={false}
                    withAsterisk={draft.status === "awaiting_reimbursement"}
                    disabled={!isManualExpenseStatus(draft.status)}
                  />
                )}
              </SimpleGrid>
            )}

            <SimpleGrid className={classes.formGrid} cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                label={isCreatingVolunteerFundSpend ? "Description" : "Note"}
                placeholder={isCreatingVolunteerFundSpend ? "What was purchased?" : "Add a short note"}
                value={draft.description ?? ""}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, description: event.currentTarget.value || null }))
                }
                withAsterisk={isCreatingVolunteerFundSpend}
              />
              <Box className={classes.receiptField}>
                <Text className={classes.receiptLabel}>Receipt</Text>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: "none" }}
                  onChange={handleFileSelect}
                />
                <Button
                  className={classes.receiptButton}
                  type="button"
                  variant={draft.invoiceFileId ? "light" : "default"}
                  leftSection={<IconFileUpload size={16} />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingInvoice || saving}
                >
                  {draft.invoiceFileId ? "Replace receipt" : "Upload receipt"}
                </Button>
              </Box>
            </SimpleGrid>

            {(uploadingInvoice || draft.invoiceFileId) && (
              <Group className={classes.receiptMeta} gap="sm" wrap="wrap" align="center" justify="center">
                {uploadingInvoice && (
                  <Group gap="xs" align="center" style={{ flex: "1 1 220px", maxWidth: 420 }}>
                    <Progress value={uploadProgress} style={{ flex: 1 }} />
                    <Text size="sm" c="dimmed">{uploadProgress}%</Text>
                  </Group>
                )}
                {draft.invoiceFileId && (
                  <Badge color="green" variant="light">
                    Receipt attached · file #{draft.invoiceFileId}
                  </Badge>
                )}
              </Group>
            )}
            {draft.invoiceFileId && files.latest?.id === draft.invoiceFileId && (
              <Text size="xs" c="dimmed" ta="center">{files.latest.originalName}</Text>
            )}
            {uploadError && <Alert className={classes.formAlert} color="red">{uploadError}</Alert>}

            {saveError && <Alert className={classes.formAlert} color="red">{saveError}</Alert>}

            <FinanceModalFooter>
              <Group className={classes.footerContent} gap="sm" wrap="wrap" justify="center">
                <Button type="button" variant="default" onClick={closeModal} disabled={saving || uploadingInvoice}>
                  Cancel
                </Button>
                <FinancePrimaryAction
                  type="submit"
                  leftSection={draft.kind === "transfer"
                    ? <IconArrowsLeftRight size={16} />
                    : isCreatingVolunteerFundSpend
                      ? <IconWallet size={16} />
                      : undefined}
                  loading={saving}
                  disabled={
                    uploadingInvoice
                    || (!editingTransaction && (!transactionAccess.ready || !transactionAccess.canCreate))
                    || accountCurrencyMismatch
                    || transferCurrencyMismatch
                    || (!editingTransaction && volunteerFundsQuery.isFetching)
                    || (!editingTransaction && volunteerFundsQuery.isError)
                    || selectedVolunteerFundResolution.status === "ambiguous"
                    || transferUsesVolunteerFund
                    || volunteerFundSpendBlocked
                  }
                >
                  {draft.kind === "transfer"
                    ? "Create transfer"
                    : editingTransaction
                      ? "Save changes"
                      : isCreatingVolunteerFundSpend
                        ? "Record fund spend"
                        : "Save transaction"}
                </FinancePrimaryAction>
              </Group>
            </FinanceModalFooter>
          </Stack>
        </form>
      </FinanceModal>
    </Stack>
  );
};

export default FinanceTransactions;
