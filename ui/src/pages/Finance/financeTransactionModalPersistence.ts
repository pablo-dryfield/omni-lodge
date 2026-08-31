import type {
  FinanceTransactionCounterpartyType,
  FinanceTransactionKind,
  FinanceTransactionStatus,
} from "../../types/finance";

export const FINANCE_TRANSACTION_MODAL_QUERY_PARAMS = {
  mode: "transactionModal",
  transactionId: "transactionId",
} as const;

export const FINANCE_TRANSACTION_DRAFT_VERSION = 1 as const;
export const FINANCE_TRANSACTION_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const FINANCE_TRANSACTION_IDEMPOTENCY_KEY_MAX_LENGTH = 180;

const FINANCE_TRANSACTION_DRAFT_STORAGE_PREFIX = "omni-lodge:finance:transaction-draft";
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type FinanceTransactionModalState =
  | { mode: "closed"; transactionId: null }
  | { mode: "create"; transactionId: null }
  | { mode: "edit"; transactionId: number };

export type FinanceTransactionActiveModalState = Exclude<
  FinanceTransactionModalState,
  { mode: "closed" }
>;

export type FinanceTransactionDraft = {
  kind: FinanceTransactionKind;
  date: string;
  accountId: number | null;
  targetAccountId?: number | null;
  currency: string;
  amountMinor: number;
  fxRate: number;
  categoryId: number | null;
  counterpartyType: FinanceTransactionCounterpartyType;
  counterpartyId: number | null;
  status: FinanceTransactionStatus;
  description: string | null;
  invoiceFileId: number | null;
  meta: Record<string, unknown> | null;
};

export type RestoredFinanceTransactionDraft = {
  draft: FinanceTransactionDraft;
  volunteerFundSpendIdempotencyKey: string | null;
  updatedAt: string;
};

export type FinanceTransactionDraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type PersistedFinanceTransactionDraft = RestoredFinanceTransactionDraft & {
  version: typeof FINANCE_TRANSACTION_DRAFT_VERSION;
  userId: number;
  modalMode: FinanceTransactionActiveModalState["mode"];
  transactionId: number | null;
};

const CLOSED_MODAL_STATE: FinanceTransactionModalState = {
  mode: "closed",
  transactionId: null,
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const parsePositiveIntegerParam = (value: string | null): number | null => {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
};

export const parseFinanceTransactionModalSearchParams = (
  searchParams: URLSearchParams,
): FinanceTransactionModalState => {
  const modeValues = searchParams.getAll(FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.mode);
  const transactionIdValues = searchParams.getAll(
    FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.transactionId,
  );

  if (modeValues.length !== 1) {
    return CLOSED_MODAL_STATE;
  }
  if (modeValues[0] === "create") {
    return transactionIdValues.length === 0
      ? { mode: "create", transactionId: null }
      : CLOSED_MODAL_STATE;
  }
  if (modeValues[0] !== "edit" || transactionIdValues.length !== 1) {
    return CLOSED_MODAL_STATE;
  }

  const transactionId = parsePositiveIntegerParam(transactionIdValues[0]);
  return transactionId === null
    ? CLOSED_MODAL_STATE
    : { mode: "edit", transactionId };
};

export const serializeFinanceTransactionModalSearchParams = (
  currentParams: URLSearchParams,
  state: FinanceTransactionModalState,
): URLSearchParams => {
  const nextParams = new URLSearchParams(currentParams);
  nextParams.delete(FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.mode);
  nextParams.delete(FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.transactionId);

  if (state.mode === "create") {
    nextParams.set(FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.mode, "create");
  } else if (state.mode === "edit" && isPositiveSafeInteger(state.transactionId)) {
    nextParams.set(FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.mode, "edit");
    nextParams.set(
      FINANCE_TRANSACTION_MODAL_QUERY_PARAMS.transactionId,
      String(state.transactionId),
    );
  }

  return nextParams;
};

const modalStorageScope = (state: FinanceTransactionActiveModalState): string | null => {
  if (state.mode === "create") {
    return state.transactionId === null ? "create" : null;
  }
  return isPositiveSafeInteger(state.transactionId) ? `edit:${state.transactionId}` : null;
};

export const buildFinanceTransactionDraftStorageKey = (
  userId: number,
  modalState: FinanceTransactionActiveModalState,
): string | null => {
  const scope = modalStorageScope(modalState);
  if (!isPositiveSafeInteger(userId) || !scope) {
    return null;
  }
  return `${FINANCE_TRANSACTION_DRAFT_STORAGE_PREFIX}:v${FINANCE_TRANSACTION_DRAFT_VERSION}:user:${userId}:${scope}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isJsonValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    const valid = value.every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!isRecord(value) || seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
};

const isNullablePositiveInteger = (value: unknown): value is number | null =>
  value === null || isPositiveSafeInteger(value);

const isValidDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const TRANSACTION_KINDS: readonly FinanceTransactionKind[] = [
  "income",
  "expense",
  "transfer",
  "refund",
];
const TRANSACTION_STATUSES: readonly FinanceTransactionStatus[] = [
  "planned",
  "approved",
  "awaiting_reimbursement",
  "paid",
  "reimbursed",
  "void",
];
const COUNTERPARTY_TYPES: readonly FinanceTransactionCounterpartyType[] = [
  "vendor",
  "client",
  "none",
];

const parseDraft = (value: unknown): FinanceTransactionDraft | null => {
  if (!isRecord(value)) {
    return null;
  }
  const targetAccountId = value.targetAccountId === undefined ? null : value.targetAccountId;
  if (
    !TRANSACTION_KINDS.includes(value.kind as FinanceTransactionKind)
    || !isValidDate(value.date)
    || !isNullablePositiveInteger(value.accountId)
    || !isNullablePositiveInteger(targetAccountId)
    || typeof value.currency !== "string"
    || value.currency.trim().length === 0
    || value.currency.length > 16
    || typeof value.amountMinor !== "number"
    || !Number.isSafeInteger(value.amountMinor)
    || value.amountMinor < 0
    || typeof value.fxRate !== "number"
    || !Number.isFinite(value.fxRate)
    || value.fxRate <= 0
    || !isNullablePositiveInteger(value.categoryId)
    || !COUNTERPARTY_TYPES.includes(value.counterpartyType as FinanceTransactionCounterpartyType)
    || !isNullablePositiveInteger(value.counterpartyId)
    || !TRANSACTION_STATUSES.includes(value.status as FinanceTransactionStatus)
    || (value.description !== null && typeof value.description !== "string")
    || !isNullablePositiveInteger(value.invoiceFileId)
    || (value.meta !== null && (!isRecord(value.meta) || !isJsonValue(value.meta)))
  ) {
    return null;
  }

  return {
    kind: value.kind as FinanceTransactionKind,
    date: value.date,
    accountId: value.accountId,
    targetAccountId,
    currency: value.currency,
    amountMinor: value.amountMinor,
    fxRate: value.fxRate,
    categoryId: value.categoryId,
    counterpartyType: value.counterpartyType as FinanceTransactionCounterpartyType,
    counterpartyId: value.counterpartyId,
    status: value.status as FinanceTransactionStatus,
    description: value.description,
    invoiceFileId: value.invoiceFileId,
    meta: value.meta,
  };
};

const isValidIdempotencyKey = (value: unknown): value is string =>
  typeof value === "string"
  && value.length > 0
  && value.length <= FINANCE_TRANSACTION_IDEMPOTENCY_KEY_MAX_LENGTH
  && value.trim() === value;

const matchesModalState = (
  persisted: Record<string, unknown>,
  expected: FinanceTransactionActiveModalState,
): boolean => persisted.modalMode === expected.mode
  && persisted.transactionId === expected.transactionId;

export const serializeFinanceTransactionDraft = (
  userId: number,
  modalState: FinanceTransactionActiveModalState,
  draft: FinanceTransactionDraft,
  volunteerFundSpendIdempotencyKey: string | null = null,
  nowMs: number = Date.now(),
): string | null => {
  const normalizedDraft = parseDraft(draft);
  const validKey = volunteerFundSpendIdempotencyKey === null
    || isValidIdempotencyKey(volunteerFundSpendIdempotencyKey);
  if (
    !buildFinanceTransactionDraftStorageKey(userId, modalState)
    || !normalizedDraft
    || !Number.isFinite(nowMs)
    || nowMs < 0
    || !validKey
    || (modalState.mode === "create" && !isValidIdempotencyKey(volunteerFundSpendIdempotencyKey))
  ) {
    return null;
  }

  const envelope: PersistedFinanceTransactionDraft = {
    version: FINANCE_TRANSACTION_DRAFT_VERSION,
    userId,
    modalMode: modalState.mode,
    transactionId: modalState.transactionId,
    updatedAt: new Date(nowMs).toISOString(),
    volunteerFundSpendIdempotencyKey,
    draft: normalizedDraft,
  };
  try {
    return JSON.stringify(envelope);
  } catch (_error) {
    return null;
  }
};

export const parseFinanceTransactionDraft = (
  raw: string | null,
  userId: number,
  modalState: FinanceTransactionActiveModalState,
  nowMs: number = Date.now(),
): RestoredFinanceTransactionDraft | null => {
  if (
    !raw
    || !buildFinanceTransactionDraftStorageKey(userId, modalState)
    || !Number.isFinite(nowMs)
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== FINANCE_TRANSACTION_DRAFT_VERSION
      || parsed.userId !== userId
      || !matchesModalState(parsed, modalState)
      || typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    const updatedAtMs = Date.parse(parsed.updatedAt);
    if (
      !Number.isFinite(updatedAtMs)
      || new Date(updatedAtMs).toISOString() !== parsed.updatedAt
      || nowMs - updatedAtMs > FINANCE_TRANSACTION_DRAFT_MAX_AGE_MS
      || updatedAtMs - nowMs > MAX_FUTURE_CLOCK_SKEW_MS
    ) {
      return null;
    }
    const draft = parseDraft(parsed.draft);
    const idempotencyKey = parsed.volunteerFundSpendIdempotencyKey ?? null;
    if (
      !draft
      || (idempotencyKey !== null && !isValidIdempotencyKey(idempotencyKey))
      || (modalState.mode === "create" && !isValidIdempotencyKey(idempotencyKey))
    ) {
      return null;
    }
    return {
      draft,
      volunteerFundSpendIdempotencyKey: idempotencyKey,
      updatedAt: parsed.updatedAt,
    };
  } catch (_error) {
    return null;
  }
};

export const removeFinanceTransactionDraft = (
  storage: FinanceTransactionDraftStorage,
  userId: number,
  modalState: FinanceTransactionActiveModalState,
): void => {
  const storageKey = buildFinanceTransactionDraftStorageKey(userId, modalState);
  if (!storageKey) {
    return;
  }
  try {
    storage.removeItem(storageKey);
  } catch (_error) {
    // Persistence is best-effort and must not block transaction entry.
  }
};

export const writeFinanceTransactionDraft = (
  storage: FinanceTransactionDraftStorage,
  userId: number,
  modalState: FinanceTransactionActiveModalState,
  draft: FinanceTransactionDraft,
  volunteerFundSpendIdempotencyKey: string | null = null,
  nowMs: number = Date.now(),
): boolean => {
  const storageKey = buildFinanceTransactionDraftStorageKey(userId, modalState);
  const serialized = serializeFinanceTransactionDraft(
    userId,
    modalState,
    draft,
    volunteerFundSpendIdempotencyKey,
    nowMs,
  );
  if (!storageKey || !serialized) {
    removeFinanceTransactionDraft(storage, userId, modalState);
    return false;
  }
  try {
    storage.setItem(storageKey, serialized);
    return true;
  } catch (_error) {
    return false;
  }
};

export const readFinanceTransactionDraft = (
  storage: FinanceTransactionDraftStorage,
  userId: number,
  modalState: FinanceTransactionActiveModalState,
  nowMs: number = Date.now(),
): RestoredFinanceTransactionDraft | null => {
  const storageKey = buildFinanceTransactionDraftStorageKey(userId, modalState);
  if (!storageKey) {
    return null;
  }
  try {
    const restored = parseFinanceTransactionDraft(
      storage.getItem(storageKey),
      userId,
      modalState,
      nowMs,
    );
    if (!restored) {
      removeFinanceTransactionDraft(storage, userId, modalState);
    }
    return restored;
  } catch (_error) {
    return null;
  }
};
