import { canLoadHomePlannedExpenses } from "./homePlannedExpenseAccess";

describe("Home planned expenses access", () => {
  const allowed = {
    accessLoaded: true,
    financePageAllowed: true,
    canViewTransactions: true,
    roleSlug: "manager",
  };

  it.each([
    "owner",
    "admin",
    "administrator",
    "manager",
    "mgr",
    "assistant-manager",
    "assistant_manager",
    "assistantmanager",
    "assist manager",
  ])(
    "allows the supported finance role %s",
    (roleSlug) => {
      expect(canLoadHomePlannedExpenses({ ...allowed, roleSlug })).toBe(true);
    },
  );

  it("waits for access control before allowing the request", () => {
    expect(canLoadHomePlannedExpenses({ ...allowed, accessLoaded: false })).toBe(false);
  });

  it("requires both the Finance page and transaction view permission", () => {
    expect(canLoadHomePlannedExpenses({ ...allowed, financePageAllowed: false })).toBe(false);
    expect(canLoadHomePlannedExpenses({ ...allowed, canViewTransactions: false })).toBe(false);
  });

  it.each([null, "", "guide", "volunteer", "pub-crawl-guide"])(
    "does not issue a finance request for unsupported role %s",
    (roleSlug) => {
      expect(canLoadHomePlannedExpenses({ ...allowed, roleSlug })).toBe(false);
    },
  );
});
