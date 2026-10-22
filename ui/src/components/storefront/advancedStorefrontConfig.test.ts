import {
  MANAGED_STOREFRONT_KEYS,
  getAdvancedStorefrontConfig,
  mergeAdvancedStorefrontConfig,
  parseAdvancedStorefrontJson,
} from "./advancedStorefrontConfig";
import { cleanProductStorefrontConfig } from "./StorefrontRulesEditors";
import type { StorefrontProductConfig } from "../../types/products/Product";

const custom = {
  duration: "3 hours",
  inclusions: ["Food tastings", "Local guide"],
  faqs: [{ question: "Vegetarian?", answer: "On request", enabled: true }],
  details: { empty: {}, list: [], optional: null, amount: 2.5 },
};

describe("advanced storefront config", () => {
  it("round-trips custom JSON directly without an extra wrapper", () => {
    expect(parseAdvancedStorefrontJson(JSON.stringify(custom))).toEqual(custom);
    expect(mergeAdvancedStorefrontConfig({}, JSON.stringify(custom))).toEqual(custom);
  });

  it("separates custom data and preserves the latest normal form settings", () => {
    const config: StorefrontProductConfig = {
      ...custom,
      participantMode: "quantity",
      defaultStartTime: "20:00",
      minParticipants: 2,
      content: { summary: "Updated summary", meetingPoint: { name: "Market Square" } },
      availability: { cutoffMinutes: 30 },
    };
    expect(getAdvancedStorefrontConfig(config)).toEqual(custom);
    const merged = mergeAdvancedStorefrontConfig(config, '{"duration":"4 hours","newField":false}');
    expect(cleanProductStorefrontConfig(merged)).toEqual({
      participantMode: "quantity", defaultStartTime: "20:00", minParticipants: 2,
      content: config.content, availability: config.availability,
      duration: "4 hours", newField: false,
    });
    expect(config).toEqual(expect.objectContaining(custom));
  });

  it.each(["", "  ", "{}"])('clears only custom fields with %p', (text) => {
    expect(mergeAdvancedStorefrontConfig({ ...custom, phoneRequired: true }, text))
      .toEqual({ phoneRequired: true });
  });

  it.each(["[]", "null", '"text"', "1", "true"])("rejects non-object JSON %s", (text) => {
    expect(() => parseAdvancedStorefrontJson(text)).toThrow("Enter a JSON object");
  });

  it.each(['{"duration":}', '{"duration":"3h",}', '{"duration":1e400}'])("rejects invalid JSON %s", (text) => {
    expect(() => parseAdvancedStorefrontJson(text)).toThrow("Invalid JSON");
  });

  it.each(MANAGED_STOREFRONT_KEYS)("protects the managed %s field", (key) => {
    expect(() => mergeAdvancedStorefrontConfig({ phoneRequired: true }, JSON.stringify({ [key]: null })))
      .toThrow(`Use the product form above to change: ${key}`);
  });

  it("preserves nested field names and prototype-like keys as inert JSON data", () => {
    const text = '{"details":{"content":"custom","price":10},"__proto__":{"polluted":true}}';
    const merged = mergeAdvancedStorefrontConfig({ defaultStartTime: "21:00" }, text);
    expect(JSON.stringify(merged)).toBe('{"defaultStartTime":"21:00","details":{"content":"custom","price":10},"__proto__":{"polluted":true}}');
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
