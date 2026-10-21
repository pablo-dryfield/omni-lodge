import {
  canAccessBookingSanityCheck,
  canShowVolunteerProgressNavigation,
  selectCanAccessBookingSanityCheck,
} from "./accessControlSelectors";
import type { RootState } from "../store/store";

describe("booking sanity check eligibility", () => {
  it.each(["admin", "administrator", "owner", " Administrator ", "OWNER"])(
    "allows global role %s",
    roleSlug => expect(canAccessBookingSanityCheck(roleSlug)).toBe(true),
  );

  it.each(["manager", "assistant-manager", "assistant_manager", "guide", "food-tour-owner", "food-tour-admin", "", null, undefined])(
    "denies other or missing role %s",
    roleSlug => expect(canAccessBookingSanityCheck(roleSlug)).toBe(false),
  );

  it("keeps product-scoped accounts out of company-wide diagnostics", () => {
    const state = { session: { roleSlug: "owner" }, accessControl: { productTypeIds: [3] } } as RootState;
    expect(selectCanAccessBookingSanityCheck(state)).toBe(false);
  });
});

describe("volunteer progress navigation eligibility", () => {
  it.each(["owner", "admin", "administrator", "manager", "assistant_manager"])(
    "shows the page to management role %s",
    (roleSlug) => {
      expect(canShowVolunteerProgressNavigation(roleSlug, null)).toBe(true);
    },
  );

  it("shows the page to volunteers using a regular guide role", () => {
    expect(canShowVolunteerProgressNavigation("guide", "volunteer")).toBe(true);
  });

  it.each(["long_term", "guide", null])(
    "hides the page from non-volunteer staff type %s",
    (staffType) => {
      expect(canShowVolunteerProgressNavigation("guide", staffType)).toBe(false);
    },
  );
});
