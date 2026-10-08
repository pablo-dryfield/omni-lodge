import {
  type StorefrontJourneyEvent,
  storefrontJourneyEventDescription,
  storefrontJourneyEventSummary,
} from "./StorefrontActivityTimeline";

const event = (
  type: string,
  details: Record<string, unknown>,
): StorefrontJourneyEvent => ({
  id: "event-1",
  type,
  source: "client",
  severity: "info",
  sequence: 1,
  occurredAt: "2026-08-29T15:07:35.000Z",
  receivedAt: "2026-08-29T15:07:36.000Z",
  details,
});

describe("storefront journey cart item formatting", () => {
  it("identifies homepage buttons by label, placement and destination", () => {
    const clicked = event("homepage_button_clicked", {
      buttonId: "hero-halloween", buttonLabel: "Book Halloween",
      placement: "Hero: Halloweekend", destination: "/store2/halloween-pub-crawl-51/#book",
    });
    expect(storefrontJourneyEventDescription(clicked)).toBe("Clicked Book Halloween");
    expect(storefrontJourneyEventSummary(clicked)).toBe("Hero: Halloweekend | /store2/halloween-pub-crawl-51/#book");
    expect(storefrontJourneyEventDescription(event("homepage_button_clicked", {}))).toBe("Clicked a homepage button");
  });

  it("describes homepage views without mislabelling missing campaign data", () => {
    expect(storefrontJourneyEventDescription(event("homepage_viewed", {}))).toBe("Viewed homepage");
    expect(storefrontJourneyEventSummary(event("homepage_viewed", { campaign: "nye" }))).toBe("New Year's Eve homepage");
    expect(storefrontJourneyEventSummary(event("homepage_viewed", { campaign: "halloween" }))).toBe("Halloweekend homepage");
    expect(storefrontJourneyEventSummary(event("homepage_viewed", {}))).toBe("Homepage");
  });

  it("identifies the removed duplicate item and describes its complete selection", () => {
    const removed = event("cart_item_removed", {
      cartItemId: "28-1788016027000",
      cartItemNumber: 2,
      cartPosition: 2,
      productName: "Pub Crawl",
      quantity: 4,
      experienceDate: "2026-08-29",
      experienceTime: "21:00",
      participants: { men: 4, women: 0 },
      addons: [{ addonId: 3, name: "Photos", quantity: 1, value: "10", variants: [] }],
      itemTotal: 546,
      currency: "PLN",
    });

    expect(storefrontJourneyEventDescription(removed)).toBe("Removed item 02: Pub Crawl");
    expect(storefrontJourneyEventSummary(removed)).toEqual(expect.stringContaining("29 Aug 2026"));
    expect(storefrontJourneyEventSummary(removed)).toEqual(expect.stringContaining("4 men"));
    expect(storefrontJourneyEventSummary(removed)).toEqual(expect.stringContaining("Photos: 10"));
    expect(storefrontJourneyEventSummary(removed)).toEqual(expect.stringContaining("546.00"));
  });

  it("shows before and after selections including add-on size variants", () => {
    const updated = event("cart_item_updated", {
      cartItemNumber: 1,
      productName: "Pub Crawl",
      previousItem: {
        quantity: 2,
        experienceDate: "2026-08-29",
        experienceTime: "21:00",
        participants: { men: 2, women: 0 },
        addons: [],
        itemTotal: 240,
        currency: "PLN",
      },
      newItem: {
        quantity: 3,
        experienceDate: "2026-08-29",
        experienceTime: "21:00",
        participants: { men: 2, women: 1 },
        addons: [{
          addonId: 2,
          name: "T-Shirts",
          quantity: 3,
          variants: [
            { value: "S", quantity: 1 },
            { value: "M", quantity: 2 },
          ],
        }],
        itemTotal: 492,
        currency: "PLN",
      },
    });

    expect(storefrontJourneyEventDescription(updated)).toBe("Updated item 01: Pub Crawl");
    expect(storefrontJourneyEventSummary(updated)).toEqual(expect.stringContaining("Before:"));
    expect(storefrontJourneyEventSummary(updated)).toEqual(expect.stringContaining("After:"));
    expect(storefrontJourneyEventSummary(updated)).toEqual(expect.stringContaining("T-Shirts: S x 1, M x 2"));
  });
});
