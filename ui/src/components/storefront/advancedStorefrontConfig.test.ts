import {
  MANAGED_STOREFRONT_KEYS,
  MANAGED_STOREFRONT_CONTENT_KEYS,
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
const card = {
  subtitle: "Polish classics & local stories",
  description: "A short card description.",
  stats: [{ icon: "plate", count: 10, label: "Food tastings" }],
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

  it("round-trips durationMinutes and nested card content without exposing standard content in the editor", () => {
    const config: StorefrontProductConfig = {
      defaultStartTime: "14:00", durationMinutes: 180,
      content: {
        summary: "Summary", description: "Long description", highlights: ["A highlight"],
        importantInformation: ["Arrive early"], meetingPoint: { name: "Market Square" },
        card, kicker: "Local food tour",
      },
    };
    const advanced = getAdvancedStorefrontConfig(config);
    expect(advanced).toEqual({ durationMinutes: 180, content: { card, kicker: "Local food tour" } });
    const json = JSON.stringify(advanced, null, 2);
    expect(parseAdvancedStorefrontJson(json)).toEqual(advanced);
    expect(cleanProductStorefrontConfig(mergeAdvancedStorefrontConfig(config, json))).toEqual(config);
  });

  it("keeps the latest standard content while replacing or deleting custom content fields", () => {
    const config: StorefrontProductConfig = {
      phoneRequired: true, durationMinutes: 180,
      content: { description: "Updated long description", card, kicker: "Old kicker" },
    };
    const changed = mergeAdvancedStorefrontConfig(config, JSON.stringify({
      durationMinutes: 120, content: { card: { ...card, description: "New short description" } },
    }));
    expect(changed).toEqual({
      phoneRequired: true, durationMinutes: 120,
      content: { description: "Updated long description", card: { ...card, description: "New short description" } },
    });
    expect(mergeAdvancedStorefrontConfig(config, '{"content":{}}')).toEqual({
      phoneRequired: true, content: { description: "Updated long description" },
    });
    expect(mergeAdvancedStorefrontConfig(config, "{}")).toEqual({
      phoneRequired: true, content: { description: "Updated long description" },
    });
    expect(config.content?.card).toEqual(card);
    expect(config.content?.kicker).toBe("Old kicker");
  });

  it("does not introduce an empty content wrapper when no content fields remain", () => {
    expect(getAdvancedStorefrontConfig({ content: { description: "Managed only" } })).toEqual({});
    expect(mergeAdvancedStorefrontConfig({ content: { card } }, "{}")).toEqual({});
    expect(mergeAdvancedStorefrontConfig({}, '{"content":{}}')).toEqual({});
  });

  it.each(MANAGED_STOREFRONT_CONTENT_KEYS)("protects the standard content.%s field", (key) => {
    expect(() => parseAdvancedStorefrontJson(JSON.stringify({ content: { [key]: null, card } })))
      .toThrow(`Use the product form above to change: content.${key}`);
  });

  it.each([null, [], "text", 123, true])("rejects invalid content object %p", (content) => {
    expect(() => parseAdvancedStorefrontJson(JSON.stringify({ content }))).toThrow("content must be a JSON object");
  });

  it("rejects non-finite numbers inside nested content", () => {
    expect(() => parseAdvancedStorefrontJson('{"content":{"card":{"count":1e400}}}')).toThrow("Numbers must be finite");
  });

  it("keeps prototype-like custom content keys inert during merging", () => {
    const merged = mergeAdvancedStorefrontConfig(
      { content: { description: "Keep this" } },
      '{"content":{"__proto__":{"polluted":true},"card":{"description":"Short"}}}',
    );
    expect(merged.content).toEqual(JSON.parse('{"description":"Keep this","__proto__":{"polluted":true},"card":{"description":"Short"}}'));
    expect(Object.getPrototypeOf(merged.content)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("preserves nested field names and prototype-like keys as inert JSON data", () => {
    const text = '{"details":{"content":"custom","price":10},"__proto__":{"polluted":true}}';
    const merged = mergeAdvancedStorefrontConfig({ defaultStartTime: "21:00" }, text);
    expect(JSON.stringify(merged)).toBe('{"defaultStartTime":"21:00","details":{"content":"custom","price":10},"__proto__":{"polluted":true}}');
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
