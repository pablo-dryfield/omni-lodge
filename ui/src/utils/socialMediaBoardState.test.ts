import {
  buildSocialMediaEditorDraftStorageKey,
  canAccessSocialMediaEditor,
  formatHashtag,
  normalizeHashtags,
  parseSocialMediaBoardUrlState,
  parseStoredSocialMediaEditorDraft,
  resolveEditorAfterMediaFailure,
  serializeSocialMediaEditorDraft,
  toSocialMediaDateOnly,
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

  it("uses the permission that matches the requested editor mode", () => {
    expect(canAccessSocialMediaEditor("new", { canCreate: true, canUpdate: false })).toBe(true);
    expect(canAccessSocialMediaEditor("new", { canCreate: false, canUpdate: true })).toBe(false);
    expect(canAccessSocialMediaEditor(42, { canCreate: true, canUpdate: false })).toBe(false);
    expect(canAccessSocialMediaEditor(42, { canCreate: false, canUpdate: true })).toBe(true);
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

  it("recovers a valid refresh-safe draft while ignoring retired workflow fields", () => {
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
    expect(draft?.values).toEqual({
      title: "Weekend reel",
      idea: "Fast cuts",
      onVideoCaptions: "Friday / Saturday",
      platformCaption: "Meet us in Krakow",
      hashtags: ["krakow"],
    });
  });

  it("accepts legacy versionless drafts, numeric-string ids, and string versions", () => {
    const legacy = parseStoredSocialMediaEditorDraft(JSON.stringify({
      editor: "42",
      values: { title: "Legacy", hashtags: "#Krakow, #Nightlife" },
    }));
    const stringVersion = parseStoredSocialMediaEditorDraft(JSON.stringify({
      version: "1",
      editor: 42,
      values: { title: "Current" },
    }));

    expect(legacy?.editor).toBe(42);
    expect(legacy?.values.hashtags).toEqual(["krakow", "nightlife"]);
    expect(stringVersion?.editor).toBe(42);
    expect(parseStoredSocialMediaEditorDraft(JSON.stringify({
      version: 2,
      editor: 42,
      values: {},
    }))).toBeNull();
  });

  it("serializes the five-field brief with a versioned round-trip schema", () => {
    const raw = serializeSocialMediaEditorDraft(42, {
      title: "New hook",
      idea: "A short idea",
      onVideoCaptions: "Look here",
      platformCaption: "Join us",
      hashtags: ["#Krakow", "##krakow", "#Party"],
    }, "2026-09-02T12:00:00.000Z");

    expect(JSON.parse(raw)).toMatchObject({ version: 1, editor: 42 });
    expect(parseStoredSocialMediaEditorDraft(raw)?.values.hashtags).toEqual(["krakow", "party"]);
  });

  it("normalizes hashtags for the API", () => {
    expect(normalizeHashtags(["#Krakow", " Krakow ", "##pubcrawl", ""])).toEqual([
      "krakow",
      "pubcrawl",
    ]);
  });

  it("deduplicates tags case-insensitively and renders exactly one leading hash", () => {
    const normalized = normalizeHashtags(["##Krakow", "#krakow", "#NightLife"]);
    expect(normalized).toEqual(["krakow", "nightlife"]);
    expect(normalized.map(formatHashtag)).toEqual(["#krakow", "#nightlife"]);
    expect(formatHashtag("###AlreadyTagged")).toBe("#alreadytagged");
    expect(formatHashtag("###")).toBe("");
  });
});

describe("social media planned dates", () => {
  it("keeps scheduling date-only and removes time from legacy ISO values", () => {
    expect(toSocialMediaDateOnly("2026-09-04T23:30:00.000Z")).toBe("2026-09-04");
    expect(toSocialMediaDateOnly("2026-09-04")).toBe("2026-09-04");
  });

  it("rejects impossible calendar dates", () => {
    expect(toSocialMediaDateOnly("2026-02-29")).toBeNull();
    expect(toSocialMediaDateOnly("not-a-date")).toBeNull();
  });
});
