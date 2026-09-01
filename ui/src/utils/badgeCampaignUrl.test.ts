import {
  buildBadgeCampaignUrl,
  DEFAULT_BADGE_CAMPAIGN_BASE_URL,
} from "./badgeCampaignUrl";

describe("staff badge campaign URL", () => {
  it("adds staff UTM tags before the booking fragment", () => {
    const result = buildBadgeCampaignUrl(
      "https://krawlthroughkrakow.com/store2/pub-crawl-28/#book",
      "Aimee_28",
    );
    const url = new URL(result);

    expect(url.pathname).toBe("/store2/pub-crawl-28/");
    expect(url.searchParams.get("utm_source")).toBe("Aimee_28");
    expect(url.searchParams.get("utm_medium")).toBe("Badge");
    expect(url.searchParams.get("utm_campaign")).toBe("Staff");
    expect(url.hash).toBe("#book");
    expect(result.indexOf("?utm_source=")).toBeLessThan(result.indexOf("#book"));
  });

  it("uses the new storefront default when configuration is absent or invalid", () => {
    expect(buildBadgeCampaignUrl(null, "Staff")).toBe(
      buildBadgeCampaignUrl(DEFAULT_BADGE_CAMPAIGN_BASE_URL, "Staff"),
    );
    expect(buildBadgeCampaignUrl("http://store.example.com/pub-crawl", "Staff")).toBe(
      buildBadgeCampaignUrl(DEFAULT_BADGE_CAMPAIGN_BASE_URL, "Staff"),
    );
  });
});
