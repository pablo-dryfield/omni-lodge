import { canShowVolunteerProgressNavigation } from "./accessControlSelectors";

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
