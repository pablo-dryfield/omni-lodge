import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  filterVisibleHomeQuickActions,
  HOME_QUICK_ACTIONS,
  isHomeQuickActionVisibilityMap,
  type HomeQuickAction,
} from "./homeQuickActionRegistry";

describe("Home quick actions", () => {
  it("opens the Finance transaction creation flow", () => {
    const action = HOME_QUICK_ACTIONS.find(({ id }) => id === "finance-record-transaction");

    expect(action).toMatchObject({
      id: "finance-record-transaction",
      to: "/finance/transactions?transactionModal=create",
    });
    expect(action?.state).toBeUndefined();
  });

  it("shows actions only when their page and module action are allowed", () => {
    const action = HOME_QUICK_ACTIONS[0];
    const allowedPages = new Set([PAGE_SLUGS.finance]);

    expect(
      filterVisibleHomeQuickActions(
        [action],
        allowedPages,
        new Map([[PAGE_SLUGS.financeTransactions, new Set(["view", "create"])]]),
      ),
    ).toEqual([action]);

    expect(
      filterVisibleHomeQuickActions(
        [action],
        allowedPages,
        new Map([[PAGE_SLUGS.financeTransactions, new Set(["view"])]]),
      ),
    ).toEqual([]);
  });

  it("supports unrestricted shortcuts for future modules", () => {
    const action: HomeQuickAction = {
      ...HOME_QUICK_ACTIONS[0],
      id: "unrestricted-action",
      permission: undefined,
    };

    expect(filterVisibleHomeQuickActions([action], new Set(), new Map())).toEqual([action]);
  });

  it("lets audience rules hide but never grant permission to a shortcut", () => {
    const action = HOME_QUICK_ACTIONS[0];
    const createPermission = new Map([
      [PAGE_SLUGS.financeTransactions, new Set(["view", "create"])],
    ]);

    expect(filterVisibleHomeQuickActions(
      [action],
      new Set([PAGE_SLUGS.finance]),
      createPermission,
      { [action.id]: false },
    )).toEqual([]);

    expect(filterVisibleHomeQuickActions(
      [action],
      new Set(),
      createPermission,
      { [action.id]: true },
    )).toEqual([]);
  });

  it("accepts only explicit boolean visibility maps", () => {
    expect(isHomeQuickActionVisibilityMap({})).toBe(true);
    expect(isHomeQuickActionVisibilityMap({ "finance-record-transaction": false })).toBe(true);
    expect(isHomeQuickActionVisibilityMap(undefined)).toBe(false);
    expect(isHomeQuickActionVisibilityMap(null)).toBe(false);
    expect(isHomeQuickActionVisibilityMap([])).toBe(false);
    expect(isHomeQuickActionVisibilityMap({ "finance-record-transaction": "false" })).toBe(false);
  });
});
