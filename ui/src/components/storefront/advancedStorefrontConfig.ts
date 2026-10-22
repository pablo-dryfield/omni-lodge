import type { StorefrontProductConfig } from "../../types/products/Product";

// These fields belong to the normal product form. Custom fields may also live
// under content, without being able to replace the standard content fields.
export const MANAGED_STOREFRONT_KEYS = [
  "participantMode", "minParticipants", "maxParticipants", "sectionOrder",
  "dateRequired", "timeMode", "defaultStartTime", "startTimes",
  "fullNameRequired", "emailRequired", "phoneRequired", "availability",
] as const;

export const MANAGED_STOREFRONT_CONTENT_KEYS = [
  "summary", "description", "highlights", "importantInformation", "meetingPoint",
] as const;

const managedKeys = new Set<string>(MANAGED_STOREFRONT_KEYS);
const managedContentKeys = new Set<string>(MANAGED_STOREFRONT_CONTENT_KEYS);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const pickFields = (
  value: Record<string, unknown>,
  include: (key: string) => boolean,
): Record<string, unknown> => Object.fromEntries(Object.entries(value).filter(([key]) => include(key)));

export const getAdvancedStorefrontConfig = (
  config: StorefrontProductConfig,
): Record<string, unknown> => {
  const advanced = pickFields(config, (key) => key !== "content" && !managedKeys.has(key));
  const content = pickFields(isObject(config.content) ? config.content : {}, (key) => !managedContentKeys.has(key));
  if (Object.keys(content).length > 0) advanced.content = content;
  return advanced;
};

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
  if (!isObject(parsed)) {
    throw new Error("Enter a JSON object, for example {\"duration\": \"3 hours\"}.");
  }
  const reserved = Object.keys(parsed).filter((key) => managedKeys.has(key));
  if (reserved.length > 0) {
    throw new Error(`Use the product form above to change: ${reserved.join(", ")}.`);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "content")) {
    if (!isObject(parsed.content)) {
      throw new Error("content must be a JSON object, for example {\"content\": {\"card\": {}}}.");
    }
    const reservedContent = Object.keys(parsed.content).filter((key) => managedContentKeys.has(key));
    if (reservedContent.length > 0) {
      throw new Error(`Use the product form above to change: ${reservedContent.map((key) => `content.${key}`).join(", ")}.`);
    }
  }
  return parsed;
};

export const mergeAdvancedStorefrontConfig = (
  config: StorefrontProductConfig,
  advancedJson: string,
): StorefrontProductConfig => {
  const advanced = parseAdvancedStorefrontJson(advancedJson);
  const content = {
    ...pickFields(isObject(config.content) ? config.content : {}, (key) => managedContentKeys.has(key)),
    ...(isObject(advanced.content) ? advanced.content : {}),
  };
  return {
    ...pickFields(config, (key) => managedKeys.has(key)),
    ...pickFields(advanced, (key) => key !== "content"),
    ...(Object.keys(content).length > 0 ? { content } : {}),
  };
};
