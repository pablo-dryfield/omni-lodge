import type { StorefrontProductConfig } from "../../types/products/Product";

// These fields belong to the normal product form. Keep unknown top-level fields
// separate so formatting/editing JSON cannot reset booking rules or content.
export const MANAGED_STOREFRONT_KEYS = [
  "participantMode", "minParticipants", "maxParticipants", "sectionOrder",
  "dateRequired", "timeMode", "defaultStartTime", "startTimes",
  "fullNameRequired", "emailRequired", "phoneRequired", "content", "availability",
] as const;

const managedKeys = new Set<string>(MANAGED_STOREFRONT_KEYS);

export const getAdvancedStorefrontConfig = (
  config: StorefrontProductConfig,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(config).filter(([key]) => !managedKeys.has(key)));

export const parseAdvancedStorefrontJson = (text: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim() || "{}", (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("Numbers must be finite.");
      }
      return value;
    });
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : "Check the syntax."}`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Enter a JSON object, for example {\"duration\": \"3 hours\"}.");
  }
  const reserved = Object.keys(parsed).filter((key) => managedKeys.has(key));
  if (reserved.length > 0) {
    throw new Error(`Use the product form above to change: ${reserved.join(", ")}.`);
  }
  return parsed as Record<string, unknown>;
};

export const mergeAdvancedStorefrontConfig = (
  config: StorefrontProductConfig,
  advancedJson: string,
): StorefrontProductConfig => ({
  ...Object.fromEntries(Object.entries(config).filter(([key]) => managedKeys.has(key))),
  ...parseAdvancedStorefrontJson(advancedJson),
});
