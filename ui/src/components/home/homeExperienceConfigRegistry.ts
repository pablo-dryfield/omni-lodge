import { HOME_QUICK_ACTIONS } from "./homeQuickActionRegistry";

export type HomeExperienceConfigurableItemKind = "quick_action" | "section";

export type HomeExperienceConfigurableItem = {
  id: string;
  label: string;
  description: string;
  group: string;
  kind: HomeExperienceConfigurableItemKind;
};

/**
 * Visibility key returned inside the current user's home preference.
 *
 * A missing value intentionally means visible so existing installations keep
 * showing planned payments until an administrator saves a different rule.
 */
export const HOME_PLANNED_PAYMENTS_VISIBILITY_KEY = "home-planned-payments";
export const HOME_VOLUNTEER_PROGRESS_VISIBILITY_KEY = "home-volunteer-progress";

export const HOME_CONFIGURABLE_SECTIONS: HomeExperienceConfigurableItem[] = [
  {
    id: HOME_VOLUNTEER_PROGRESS_VISIBILITY_KEY,
    label: "Volunteer progress",
    description: "Show volunteers their own stay and five-star progress before Modules. Requires a Volunteer staff profile and Volunteer Progress access.",
    group: "Homepage section",
    kind: "section",
  },
  {
    id: HOME_PLANNED_PAYMENTS_VISIBILITY_KEY,
    label: "Planned payments",
    description: "Show actionable planned finance payments on the homepage when any are due.",
    group: "Homepage section",
    kind: "section",
  },
];

export const HOME_EXPERIENCE_CONFIGURABLE_ITEMS: HomeExperienceConfigurableItem[] = [
  ...HOME_CONFIGURABLE_SECTIONS,
  ...HOME_QUICK_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    description: action.description,
    group: action.group,
    kind: "quick_action" as const,
  })),
];
