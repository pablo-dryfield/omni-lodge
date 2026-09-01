import {
  HOME_CONFIGURABLE_SECTIONS,
  HOME_EXPERIENCE_CONFIGURABLE_ITEMS,
  HOME_PLANNED_PAYMENTS_VISIBILITY_KEY,
} from "./homeExperienceConfigRegistry";
import { HOME_QUICK_ACTIONS } from "./homeQuickActionRegistry";

describe("home experience configuration registry", () => {
  it("registers planned payments as a homepage section, not a quick action", () => {
    expect(HOME_CONFIGURABLE_SECTIONS).toContainEqual(expect.objectContaining({
      id: HOME_PLANNED_PAYMENTS_VISIBILITY_KEY,
      kind: "section",
    }));
    expect(HOME_QUICK_ACTIONS.some(
      (action) => action.id === HOME_PLANNED_PAYMENTS_VISIBILITY_KEY,
    )).toBe(false);
  });

  it("keeps every configurable homepage item key unique", () => {
    const ids = HOME_EXPERIENCE_CONFIGURABLE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
