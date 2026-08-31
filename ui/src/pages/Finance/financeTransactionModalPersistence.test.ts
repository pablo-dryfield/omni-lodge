import {
  FINANCE_TRANSACTION_DRAFT_MAX_AGE_MS,
  buildFinanceTransactionDraftStorageKey,
  parseFinanceTransactionDraft,
  parseFinanceTransactionModalSearchParams,
  readFinanceTransactionDraft,
  removeFinanceTransactionDraft,
  serializeFinanceTransactionDraft,
  serializeFinanceTransactionModalSearchParams,
  writeFinanceTransactionDraft,
  type FinanceTransactionDraft,
} from "./financeTransactionModalPersistence";

const createModal = { mode: "create", transactionId: null } as const;
const editModal = { mode: "edit", transactionId: 42 } as const;
const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
const idempotencyKey = "manual-spend:finance-transactions:test-key";

const draft: FinanceTransactionDraft = {
  kind: "expense",
  date: "2026-08-31",
  accountId: 3,
  targetAccountId: null,
  currency: "PLN",
  amountMinor: 1299,
  fxRate: 1,
  categoryId: 7,
  counterpartyType: "vendor",
  counterpartyId: 11,
  status: "awaiting_reimbursement",
  description: "Cleaning supplies",
  invoiceFileId: 19,
  meta: { paidByUserId: 5, labels: ["office"] },
};

describe("finance transaction modal URL state", () => {
  it.each([
    ["", { mode: "closed", transactionId: null }],
    ["transactionModal=create", createModal],
    ["transactionModal=edit&transactionId=42", editModal],
  ])("parses %s", (query, expected) => {
    expect(parseFinanceTransactionModalSearchParams(new URLSearchParams(query))).toEqual(expected);
  });

  it.each([
    "transactionModal=edit",
    "transactionModal=edit&transactionId=0",
    "transactionModal=edit&transactionId=1.5",
    "transactionModal=create&transactionId=42",
    "transactionModal=create&transactionModal=edit&transactionId=42",
  ])("fails closed for malformed modal state: %s", (query) => {
    expect(parseFinanceTransactionModalSearchParams(new URLSearchParams(query))).toEqual({
      mode: "closed",
      transactionId: null,
    });
  });

  it("preserves unrelated parameters while switching between create, edit, and closed", () => {
    const initial = new URLSearchParams("status=paid&source=dashboard&transactionModal=create");
    const editParams = serializeFinanceTransactionModalSearchParams(initial, editModal);

    expect(editParams.toString()).toBe(
      "status=paid&source=dashboard&transactionModal=edit&transactionId=42",
    );

    const closedParams = serializeFinanceTransactionModalSearchParams(editParams, {
      mode: "closed",
      transactionId: null,
    });
    expect(closedParams.toString()).toBe("status=paid&source=dashboard");
  });
});

describe("finance transaction draft persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses versioned keys scoped by user and modal identity", () => {
    expect(buildFinanceTransactionDraftStorageKey(8, createModal)).toBe(
      "omni-lodge:finance:transaction-draft:v1:user:8:create",
    );
    expect(buildFinanceTransactionDraftStorageKey(8, editModal)).toBe(
      "omni-lodge:finance:transaction-draft:v1:user:8:edit:42",
    );
    expect(buildFinanceTransactionDraftStorageKey(9, editModal)).not.toBe(
      buildFinanceTransactionDraftStorageKey(8, editModal),
    );
    expect(buildFinanceTransactionDraftStorageKey(0, createModal)).toBeNull();
  });

  it("round-trips every draft field and the create idempotency key", () => {
    const raw = serializeFinanceTransactionDraft(
      8,
      createModal,
      draft,
      idempotencyKey,
      nowMs,
    );

    expect(parseFinanceTransactionDraft(raw, 8, createModal, nowMs)).toEqual({
      draft,
      volunteerFundSpendIdempotencyKey: idempotencyKey,
      updatedAt: "2026-08-31T12:00:00.000Z",
    });
  });

  it("allows an edit draft to omit the create-only idempotency key", () => {
    const raw = serializeFinanceTransactionDraft(8, editModal, draft, null, nowMs);

    expect(parseFinanceTransactionDraft(raw, 8, editModal, nowMs)).toMatchObject({
      draft,
      volunteerFundSpendIdempotencyKey: null,
    });
  });

  it("rejects missing, blank, and oversized create idempotency keys", () => {
    expect(serializeFinanceTransactionDraft(8, createModal, draft, null, nowMs)).toBeNull();
    expect(serializeFinanceTransactionDraft(8, createModal, draft, " ", nowMs)).toBeNull();
    expect(serializeFinanceTransactionDraft(8, createModal, draft, "x".repeat(181), nowMs)).toBeNull();
  });

  it("rejects stale, future, wrong-user, and wrong-modal envelopes", () => {
    const raw = serializeFinanceTransactionDraft(
      8,
      createModal,
      draft,
      idempotencyKey,
      nowMs,
    );

    expect(
      parseFinanceTransactionDraft(raw, 8, createModal, nowMs + FINANCE_TRANSACTION_DRAFT_MAX_AGE_MS + 1),
    ).toBeNull();
    expect(parseFinanceTransactionDraft(raw, 8, createModal, nowMs - 5 * 60 * 1000 - 1)).toBeNull();
    expect(parseFinanceTransactionDraft(raw, 9, createModal, nowMs)).toBeNull();
    expect(parseFinanceTransactionDraft(raw, 8, editModal, nowMs)).toBeNull();
  });

  it.each([
    ["kind", "other"],
    ["date", "2026-02-30"],
    ["accountId", -1],
    ["amountMinor", 12.5],
    ["fxRate", 0],
    ["status", "unknown"],
    ["meta", []],
  ])("runtime-validates draft field %s", (field, invalidValue) => {
    const raw = serializeFinanceTransactionDraft(
      8,
      createModal,
      draft,
      idempotencyKey,
      nowMs,
    );
    const envelope = JSON.parse(raw as string) as { draft: Record<string, unknown> };
    envelope.draft[field] = invalidValue;

    expect(
      parseFinanceTransactionDraft(JSON.stringify(envelope), 8, createModal, nowMs),
    ).toBeNull();
  });

  it("writes, reads, and explicitly removes a draft", () => {
    expect(
      writeFinanceTransactionDraft(
        window.localStorage,
        8,
        createModal,
        draft,
        idempotencyKey,
        nowMs,
      ),
    ).toBe(true);
    expect(readFinanceTransactionDraft(window.localStorage, 8, createModal, nowMs)).toMatchObject({
      draft,
      volunteerFundSpendIdempotencyKey: idempotencyKey,
    });

    removeFinanceTransactionDraft(window.localStorage, 8, createModal);
    expect(readFinanceTransactionDraft(window.localStorage, 8, createModal, nowMs)).toBeNull();
  });

  it("removes malformed or stale storage without throwing", () => {
    const storageKey = buildFinanceTransactionDraftStorageKey(8, createModal) as string;
    window.localStorage.setItem(storageKey, "not-json");

    expect(readFinanceTransactionDraft(window.localStorage, 8, createModal, nowMs)).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    const stale = serializeFinanceTransactionDraft(
      8,
      createModal,
      draft,
      idempotencyKey,
      nowMs - FINANCE_TRANSACTION_DRAFT_MAX_AGE_MS - 1,
    ) as string;
    window.localStorage.setItem(storageKey, stale);
    expect(readFinanceTransactionDraft(window.localStorage, 8, createModal, nowMs)).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("fails safely when storage is unavailable", () => {
    const unavailableStorage = {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
      removeItem: () => { throw new Error("unavailable"); },
    };

    expect(readFinanceTransactionDraft(unavailableStorage, 8, createModal, nowMs)).toBeNull();
    expect(
      writeFinanceTransactionDraft(
        unavailableStorage,
        8,
        createModal,
        draft,
        idempotencyKey,
        nowMs,
      ),
    ).toBe(false);
    expect(() => removeFinanceTransactionDraft(unavailableStorage, 8, createModal)).not.toThrow();
  });
});
