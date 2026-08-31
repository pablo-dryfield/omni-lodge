import {
  financeNavigationItems,
  isFinanceNavigationItemActive,
} from "./financeNavigation";

describe("financeNavigation", () => {
  it("exposes every finance route once, including inventory", () => {
    const paths = financeNavigationItems.map((item) => item.path);

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/finance/inventory");
    expect(paths).toContain("/finance/volunteer-funds");
    expect(paths).toContain("/finance/management-requests");
  });

  it("does not mark the dashboard active for nested routes", () => {
    expect(isFinanceNavigationItemActive("/finance", "/finance")).toBe(true);
    expect(isFinanceNavigationItemActive("/finance/accounts", "/finance")).toBe(false);
    expect(isFinanceNavigationItemActive("/finance/accounts", "/finance/accounts")).toBe(true);
  });
});
