import {
  buildSocialMediaEditorDraftStorageKey,
  normalizeHashtags,
  parseSocialMediaBoardUrlState,
  parseStoredSocialMediaEditorDraft,
  resolveEditorAfterMediaFailure,
  writeSocialMediaBoardUrlState,
} from "./socialMediaBoardState";

describe("social media board URL state", () => {
  it("parses persisted filters and an edit selection", () => {
    expect(parseSocialMediaBoardUrlState(new URLSearchParams(
      "search=reel&status=ready&platform=Instagram&editor=42",
    ))).toEqual({ search: "reel", status: "ready", platform: "instagram", editor: 42 });
  });

  it("writes canonical params while preserving unrelated query values", () => {
    const result = writeSocialMediaBoardUrlState(new URLSearchParams("source=home"), {
      search: " launch ",
      status: "all",
      platform: "TikTok",
      editor: "new",
    });
    expect(result.toString()).toBe("source=home&search=launch&platform=tiktok&editor=new");
  });

  it("rejects invalid status and editor values", () => {
    expect(parseSocialMediaBoardUrlState(new URLSearchParams("status=unknown&editor=-2"))).toEqual({
      search: "",
      status: "all",
      platform: "",
      editor: null,
    });
  });

  it("switches a partially created item to edit mode before a media retry", () => {
    expect(resolveEditorAfterMediaFailure("new", 84)).toBe(84);
    expect(resolveEditorAfterMediaFailure(42, 84)).toBe(42);
  });
});

describe("social media editor draft persistence", () => {
  it("keeps drafts separate for each signed-in user", () => {
    expect(buildSocialMediaEditorDraftStorageKey(17)).toBe(
      "omni.socialMedia.editorDraft.v1.17",
    );
    expect(buildSocialMediaEditorDraftStorageKey(null)).toBe(
      "omni.socialMedia.editorDraft.v1",
    );
  });

  it("recovers a valid refresh-safe draft", () => {
    const draft = parseStoredSocialMediaEditorDraft(JSON.stringify({
      version: 1,
      editor: "new",
      savedAt: "2026-09-01T10:00:00.000Z",
      values: {
        title: "Weekend reel",
        idea: "Fast cuts",
        onVideoCaptions: "Friday / Saturday",
        platformCaption: "Meet us in Krakow",
        hashtags: ["krakow", "krakow"],
        targetPlatforms: ["instagram"],
        status: "planned",
        scheduledAt: "2026-09-04T18:00:00.000Z",
        driveProjectUrl: "https://drive.google.com/example",
        platformLinks: { instagram: "https://instagram.com/example" },
      },
    }));
    expect(draft?.editor).toBe("new");
    expect(draft?.values.title).toBe("Weekend reel");
    expect(draft?.values.hashtags).toEqual(["krakow"]);
    expect(draft?.values.platformLinks).toEqual({ instagram: "https://instagram.com/example" });
  });

  it("normalizes hashtags for the API", () => {
    expect(normalizeHashtags(["#Krakow", " Krakow ", "##pubcrawl", ""])).toEqual([
      "Krakow",
      "pubcrawl",
    ]);
  });

  it("stores tags without a leading hash so rendering never produces double hashes", () => {
    const normalized = normalizeHashtags(["##krakow", "#nightlife"]);
    expect(normalized.map((tag) => `#${tag}`)).toEqual(["#krakow", "#nightlife"]);
  });
});
