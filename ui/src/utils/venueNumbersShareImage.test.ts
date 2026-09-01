import type { VenuePayoutVenueBreakdown } from "../types/nightReports/VenuePayoutSummary";
import {
  buildVenueSummaryShareModel,
  resolveVenueSummaryShareCanvasLayout,
  shareVenueSummaryImage,
} from "./venueNumbersShareImage";

const range = {
  startDate: "2026-08-01",
  endDate: "2026-08-31",
};

const commissionDetail = {
  date: "2026-08-03",
  reportId: 101,
  totalPeople: 18,
  amount: 270,
  direction: "receivable" as const,
  normalCount: 0,
  cocktailsCount: 0,
  brunchCount: 0,
};

const openBarDetail = {
  date: "2026-08-05",
  reportId: 202,
  totalPeople: 14,
  amount: 140,
  direction: "payable" as const,
  normalCount: 8,
  cocktailsCount: 4,
  brunchCount: 2,
};

const commissionDetailWithDuration = {
  ...commissionDetail,
  stayDurationMinutes: 90,
};

const buildVenue = (
  overrides: Partial<VenuePayoutVenueBreakdown> = {},
): VenuePayoutVenueBreakdown => ({
  rowKey: "7|PLN",
  venueId: 7,
  venueName: "Żółty Łabędź / Main Bar",
  currency: "PLN",
  allowsOpenBar: true,
  receivable: 270,
  receivableCollected: 200,
  receivableOutstanding: 70,
  payable: 140,
  payableCollected: 40,
  payableOutstanding: 100,
  net: 130,
  totalPeople: 32,
  totalPeopleReceivable: 18,
  totalPeoplePayable: 14,
  daily: [openBarDetail, commissionDetail],
  receivableLedger: { opening: 0, due: 270, paid: 200, closing: 70 },
  payableLedger: { opening: 0, due: 140, paid: 40, closing: 100 },
  ...overrides,
});

const buildOpenBarOnlyVenue = (
  daily: VenuePayoutVenueBreakdown["daily"] = [openBarDetail],
): VenuePayoutVenueBreakdown =>
  buildVenue({
    receivable: 0,
    receivableCollected: 0,
    receivableOutstanding: 0,
    totalPeople: 14,
    totalPeopleReceivable: 0,
    net: -140,
    daily,
  });

describe("buildVenueSummaryShareModel", () => {
  it("includes both relevant sections and all detail columns for mixed venue activity", () => {
    const model = buildVenueSummaryShareModel({ venue: buildVenue(), ...range });

    expect(model.sections.map((section) => section.key)).toEqual(["commission", "openBar"]);
    expect(model.showCommissionSection).toBe(true);
    expect(model.showOpenBarSection).toBe(true);
    expect(model.showOpenBarBreakdownColumns).toBe(true);
    expect(model.showCocktailColumn).toBe(true);
    expect(model.showBrunchColumn).toBe(true);
    expect(model.showDurationColumn).toBe(false);
    expect(model.showTypeColumn).toBe(true);
    expect(model.columns.map((column) => column.key)).toEqual([
      "date",
      "totalPeople",
      "normal",
      "cocktail",
      "brunch",
      "type",
      "amount",
    ]);
    expect(model.columns.every((column) => column.align === "center")).toBe(true);
    expect(model.columns.map((column) => column.key)).not.toContain("report");
    const actualDetails = model.details.filter((detail) => !detail.placeholder);
    expect(actualDetails.map((detail) => detail.source.reportId)).toEqual([101, 202]);
    expect(actualDetails.map((detail) => detail.source)).toEqual([commissionDetail, openBarDetail]);
    expect(model.representedDayCount).toBe(31);
    expect(model.details).toHaveLength(31);
    expect(model.details.filter((detail) => detail.placeholder)).toHaveLength(29);
    expect(model.filename).toBe(
      "venue-summary-zolty-labedz-main-bar-2026-08-01-to-2026-08-31.png",
    );
  });

  it("omits open-bar-only content and columns when there is no actual payable activity", () => {
    const venue = buildVenue({
      payable: 0,
      payableCollected: 0,
      payableOutstanding: 0,
      totalPeople: 18,
      totalPeoplePayable: 0,
      daily: [commissionDetail],
    });
    const model = buildVenueSummaryShareModel({ venue, ...range });

    expect(model.sections.map((section) => section.key)).toEqual(["commission"]);
    expect(model.showOpenBarSection).toBe(false);
    expect(model.showOpenBarBreakdownColumns).toBe(false);
    expect(model.showCocktailColumn).toBe(false);
    expect(model.showBrunchColumn).toBe(false);
    expect(model.showTypeColumn).toBe(false);
    expect(model.columns.map((column) => column.key)).toEqual([
      "date",
      "totalPeople",
      "amount",
    ]);
  });

  it("omits Commission and Type for a venue with only actual open-bar activity", () => {
    const venue = buildVenue({
      receivable: 0,
      receivableCollected: 0,
      receivableOutstanding: 0,
      totalPeople: 14,
      totalPeopleReceivable: 0,
      net: -140,
      daily: [openBarDetail],
    });
    const model = buildVenueSummaryShareModel({ venue, ...range });

    expect(model.sections.map((section) => section.key)).toEqual(["openBar"]);
    expect(model.showCommissionSection).toBe(false);
    expect(model.showOpenBarSection).toBe(true);
    expect(model.showCocktailColumn).toBe(true);
    expect(model.showBrunchColumn).toBe(true);
    expect(model.showTypeColumn).toBe(false);
    expect(model.columns.map((column) => column.key)).not.toContain("type");
    expect(model.columns.map((column) => column.key)).toEqual([
      "date",
      "totalPeople",
      "normal",
      "cocktail",
      "brunch",
      "amount",
    ]);
  });

  it.each([
    {
      label: "normal only",
      cocktailsCount: 0,
      brunchCount: 0,
      showCocktailColumn: false,
      showBrunchColumn: false,
      columns: ["date", "totalPeople", "normal", "amount"],
      layout: {
        logicalWidth: 257,
        contentWidth: 241,
        tableWidth: 241,
        tableX: 8,
        scale: 21,
        outputWidth: 5397,
      },
    },
    {
      label: "cocktail only",
      cocktailsCount: 3,
      brunchCount: 0,
      showCocktailColumn: true,
      showBrunchColumn: false,
      columns: ["date", "totalPeople", "normal", "cocktail", "amount"],
      layout: {
        logicalWidth: 303,
        contentWidth: 287,
        tableWidth: 287,
        tableX: 8,
        scale: 18,
        outputWidth: 5454,
      },
    },
    {
      label: "brunch only",
      cocktailsCount: 0,
      brunchCount: 2,
      showCocktailColumn: false,
      showBrunchColumn: true,
      columns: ["date", "totalPeople", "normal", "brunch", "amount"],
      layout: {
        logicalWidth: 297,
        contentWidth: 281,
        tableWidth: 281,
        tableX: 8,
        scale: 18,
        outputWidth: 5346,
      },
    },
    {
      label: "cocktail and brunch",
      cocktailsCount: 3,
      brunchCount: 2,
      showCocktailColumn: true,
      showBrunchColumn: true,
      columns: ["date", "totalPeople", "normal", "cocktail", "brunch", "amount"],
      layout: {
        logicalWidth: 342,
        contentWidth: 326,
        tableWidth: 326,
        tableX: 8,
        scale: 16,
        outputWidth: 5472,
      },
    },
  ])("shows only the used open-bar subtype columns for $label", (testCase) => {
    const firstPayableDetail = {
      ...openBarDetail,
      cocktailsCount: 0,
      brunchCount: 0,
    };
    const secondPayableDetail = {
      ...openBarDetail,
      date: "2026-08-06",
      reportId: 203,
      cocktailsCount: testCase.cocktailsCount,
      brunchCount: testCase.brunchCount,
    };
    const model = buildVenueSummaryShareModel({
      venue: buildOpenBarOnlyVenue([firstPayableDetail, secondPayableDetail]),
      ...range,
    });

    expect(model.showOpenBarBreakdownColumns).toBe(true);
    expect(model.showCocktailColumn).toBe(testCase.showCocktailColumn);
    expect(model.showBrunchColumn).toBe(testCase.showBrunchColumn);
    expect(model.columns.map((column) => column.key)).toEqual(testCase.columns);
    expect(resolveVenueSummaryShareCanvasLayout(model)).toEqual(testCase.layout);
  });

  it("keeps mixed Type independent when neither optional open-bar subtype is used", () => {
    const normalOnlyPayableDetail = {
      ...openBarDetail,
      cocktailsCount: 0,
      brunchCount: 0,
    };
    const model = buildVenueSummaryShareModel({
      venue: buildVenue({ daily: [commissionDetail, normalOnlyPayableDetail] }),
      ...range,
    });

    expect(model.showTypeColumn).toBe(true);
    expect(model.showCocktailColumn).toBe(false);
    expect(model.showBrunchColumn).toBe(false);
    expect(model.columns.map((column) => column.key)).toEqual([
      "date",
      "totalPeople",
      "normal",
      "type",
      "amount",
    ]);
    expect(resolveVenueSummaryShareCanvasLayout(model)).toEqual({
      logicalWidth: 429,
      contentWidth: 413,
      tableWidth: 293,
      tableX: 68,
      scale: 13,
      outputWidth: 5577,
    });
  });

  it("requires venue permission as well as actual payable activity before showing open-bar content", () => {
    const model = buildVenueSummaryShareModel({
      venue: buildVenue({ allowsOpenBar: false }),
      ...range,
    });

    expect(model.showOpenBarSection).toBe(false);
    expect(model.showOpenBarBreakdownColumns).toBe(false);
    expect(model.showCocktailColumn).toBe(false);
    expect(model.showBrunchColumn).toBe(false);
    expect(model.sections.map((section) => section.key)).toEqual(["commission"]);
    expect(
      model.details
        .filter((detail) => !detail.placeholder)
        .map((detail) => detail.source.direction),
    ).toEqual(["receivable"]);
  });

  it("adds a compact Duration column only when a real detail has a positive duration", () => {
    const model = buildVenueSummaryShareModel({
      venue: buildVenue({ daily: [openBarDetail, commissionDetailWithDuration] }),
      ...range,
    });

    expect(model.showDurationColumn).toBe(true);
    expect(model.columns.map((column) => column.key)).toEqual([
      "date",
      "totalPeople",
      "duration",
      "normal",
      "cocktail",
      "brunch",
      "type",
      "amount",
    ]);
    expect(
      model.details
        .filter((detail) => !detail.placeholder)
        .map((detail) => detail.values.duration),
    ).toEqual(["1h 30m", "—"]);

    const noPositiveDuration = buildVenueSummaryShareModel({
      venue: buildVenue({
        daily: [{ ...commissionDetailWithDuration, stayDurationMinutes: 0 }],
        payable: 0,
        payableCollected: 0,
        payableOutstanding: 0,
        totalPeoplePayable: 0,
      }),
      ...range,
    });
    expect(noPositiveDuration.showDurationColumn).toBe(false);
    expect(noPositiveDuration.columns.map((column) => column.key)).not.toContain("duration");
  });

  it("keeps collected or outstanding-only sections even when there are no daily rows", () => {
    const model = buildVenueSummaryShareModel({
      venue: buildVenue({
        daily: [],
        totalPeople: 0,
        totalPeopleReceivable: 0,
        totalPeoplePayable: 0,
        receivable: 0,
        receivableCollected: 35,
        receivableOutstanding: 0,
        payable: 0,
        payableCollected: 20,
        payableOutstanding: 0,
        receivableLedger: { opening: 35, due: 0, paid: 35, closing: 0 },
        payableLedger: { opening: 20, due: 0, paid: 20, closing: 0 },
      }),
      ...range,
    });

    expect(model.sections.map((section) => section.key)).toEqual(["commission", "openBar"]);
    expect(model.showTypeColumn).toBe(false);
    expect(model.showOpenBarBreakdownColumns).toBe(false);
    expect(model.showCocktailColumn).toBe(false);
    expect(model.showBrunchColumn).toBe(false);
    expect(model.details).toHaveLength(31);
    expect(model.details.every((detail) => detail.placeholder)).toBe(true);
    expect(model.columns.map((column) => column.key)).not.toEqual(
      expect.arrayContaining(["cocktail", "brunch"]),
    );
  });

  it("represents every calendar day while retaining multiple real entries on one date", () => {
    const secondCommissionDetail = {
      ...commissionDetail,
      reportId: 303,
      totalPeople: 7,
      amount: 105,
    };
    const model = buildVenueSummaryShareModel({
      venue: buildVenue({ daily: [openBarDetail, secondCommissionDetail, commissionDetail] }),
      ...range,
    });

    expect(model.representedDayCount).toBe(31);
    expect(new Set(model.details.map((detail) => detail.source.date.slice(0, 10))).size).toBe(31);
    expect(model.details).toHaveLength(32);
    const actualDetails = model.details.filter((detail) => !detail.placeholder);
    expect(actualDetails).toHaveLength(3);
    expect(actualDetails.map((detail) => detail.source.reportId).sort()).toEqual([101, 202, 303]);
    expect(
      model.details.filter((detail) => detail.source.date === "2026-08-03"),
    ).toHaveLength(2);
    expect(
      model.details.filter((detail) => detail.source.date === "2026-08-03").every(
        (detail) => !detail.placeholder,
      ),
    ).toBe(true);

    const placeholder = model.details.find((detail) => detail.placeholder);
    expect(placeholder).toBeDefined();
    expect(placeholder?.values).toMatchObject({
      totalPeople: "0",
      duration: "—",
      normal: "—",
      cocktail: "—",
      brunch: "—",
      type: "No activity",
    });
    expect(placeholder?.values.amount).toContain("0.00");
  });

  it("adapts logical width to the visible sections while keeping every PNG above 5200px", () => {
    const commissionOnly = buildVenueSummaryShareModel({
      venue: buildVenue({
        payable: 0,
        payableCollected: 0,
        payableOutstanding: 0,
        totalPeople: 18,
        totalPeoplePayable: 0,
        daily: [commissionDetail],
      }),
      ...range,
    });
    const openBarOnly = buildVenueSummaryShareModel({
      venue: buildVenue({
        receivable: 0,
        receivableCollected: 0,
        receivableOutstanding: 0,
        totalPeople: 14,
        totalPeopleReceivable: 0,
        daily: [openBarDetail],
      }),
      ...range,
    });
    const mixed = buildVenueSummaryShareModel({ venue: buildVenue(), ...range });

    expect(resolveVenueSummaryShareCanvasLayout(commissionOnly)).toEqual({
      logicalWidth: 220,
      contentWidth: 204,
      tableWidth: 204,
      tableX: 8,
      scale: 24,
      outputWidth: 5280,
    });
    expect(resolveVenueSummaryShareCanvasLayout(openBarOnly)).toEqual({
      logicalWidth: 342,
      contentWidth: 326,
      tableWidth: 326,
      tableX: 8,
      scale: 16,
      outputWidth: 5472,
    });
    expect(resolveVenueSummaryShareCanvasLayout(mixed)).toEqual({
      logicalWidth: 429,
      contentWidth: 413,
      tableWidth: 378,
      tableX: 25.5,
      scale: 13,
      outputWidth: 5577,
    });
    [commissionOnly, openBarOnly, mixed].forEach((model) => {
      expect(resolveVenueSummaryShareCanvasLayout(model).outputWidth).toBeGreaterThanOrEqual(5200);
    });
    const auraLayout = resolveVenueSummaryShareCanvasLayout(commissionOnly);
    expect(auraLayout.contentWidth / auraLayout.logicalWidth).toBeGreaterThan(0.9);
    expect(auraLayout.tableWidth / auraLayout.logicalWidth).toBeGreaterThan(0.9);
  });
});

describe("shareVenueSummaryImage", () => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const originalClipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
  const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let renderedCanvas: HTMLCanvasElement | null = null;
  const scaleCanvas = jest.fn();
  const fillTextCanvas = jest.fn();

  const context = {
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillRect: () => undefined,
    fillText: fillTextCanvas,
    measureText: function (this: CanvasRenderingContext2D, value: string) {
      const fontSize = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 8);
      return { width: value.length * fontSize * 0.55 } as TextMetrics;
    },
    scale: scaleCanvas,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "middle" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    renderedCanvas = null;
    scaleCanvas.mockClear();
    fillTextCanvas.mockClear();
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (function (this: HTMLCanvasElement) {
        renderedCanvas = this;
        return context;
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext,
    );
    jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
    if (originalClipboardItemDescriptor) {
      Object.defineProperty(globalThis, "ClipboardItem", originalClipboardItemDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "ClipboardItem");
    }
    if (originalCreateObjectUrlDescriptor) {
      Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectUrlDescriptor) {
      Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("copies the generated PNG through ClipboardItem when image clipboard access is available", async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const clipboardPayloads: Array<Record<string, Promise<Blob> | Blob>> = [];
    class MockClipboardItem {
      constructor(payload: Record<string, Promise<Blob> | Blob>) {
        clipboardPayloads.push(payload);
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: MockClipboardItem,
    });

    const commissionOnlyVenue = buildVenue({
      payable: 0,
      payableCollected: 0,
      payableOutstanding: 0,
      totalPeople: 18,
      totalPeoplePayable: 0,
      daily: [commissionDetailWithDuration],
    });
    await expect(
      shareVenueSummaryImage({ venue: commissionOnlyVenue, ...range }),
    ).resolves.toBe("copied");

    expect(write).toHaveBeenCalledTimes(1);
    expect(clipboardPayloads).toHaveLength(1);
    expect(clipboardPayloads[0]["image/png"]).toBeInstanceOf(Promise);
    const copiedBlob = await clipboardPayloads[0]["image/png"];
    expect(copiedBlob).toBeInstanceOf(Blob);
    expect(copiedBlob.type).toBe("image/png");
    expect(renderedCanvas).not.toBeNull();
    expect(renderedCanvas!.width).toBe(5280);
    expect(renderedCanvas!.width).toBeGreaterThanOrEqual(5200);
    expect(scaleCanvas).toHaveBeenCalledWith(24, 24);
    expect(renderedCanvas!.width / 24).toBe(220);
    expect(renderedCanvas!.height).toBe(10_896);
    expect(renderedCanvas!.width * renderedCanvas!.height).toBeLessThanOrEqual(60_000_000);
    const commissionAmount = buildVenueSummaryShareModel({
      venue: commissionOnlyVenue,
      ...range,
    }).details.find((detail) => !detail.placeholder)?.values.amount;
    expect(commissionAmount).toBeDefined();
    expect(fillTextCanvas.mock.calls.some(([value]) => value === commissionAmount)).toBe(true);
    expect(fillTextCanvas.mock.calls.some(([value]) => value === "1h 30m")).toBe(true);
  });

  it("downloads the sanitized PNG when the browser has no image clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: undefined,
    });
    const createObjectURL = jest.fn(() => "blob:venue-share");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    let downloadedFilename = "";
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
    });

    await expect(
      shareVenueSummaryImage({ venue: buildVenue(), ...range }),
    ).resolves.toBe("downloaded");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadedFilename).toBe(
      "venue-summary-zolty-labedz-main-bar-2026-08-01-to-2026-08-31.png",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:venue-share");
    expect(renderedCanvas).not.toBeNull();
    expect(renderedCanvas!.width).toBe(5577);
    expect(renderedCanvas!.height).toBe(5902);
    expect(scaleCanvas).toHaveBeenCalledWith(13, 13);
    expect(renderedCanvas!.width * renderedCanvas!.height).toBeLessThanOrEqual(60_000_000);
  });

  it("falls back to a PNG download when the clipboard write is denied", async () => {
    const write = jest.fn().mockRejectedValue(new Error("NotAllowedError"));
    class MockClipboardItem {
      readonly payload: Record<string, Promise<Blob> | Blob>;

      constructor(payload: Record<string, Promise<Blob> | Blob>) {
        this.payload = payload;
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: MockClipboardItem,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:fallback"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await expect(
      shareVenueSummaryImage({ venue: buildOpenBarOnlyVenue(), ...range }),
    ).resolves.toBe("downloaded");

    expect(write).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(renderedCanvas).not.toBeNull();
    expect(renderedCanvas!.width).toBe(5472);
    expect(renderedCanvas!.height).toBe(7264);
    expect(scaleCanvas).toHaveBeenCalledWith(16, 16);
    expect(renderedCanvas!.width * renderedCanvas!.height).toBeLessThanOrEqual(60_000_000);
  });

  it("reports an actionable error before creating an impractically tall canvas", async () => {
    const daily = Array.from({ length: 400 }, (_, index) => ({
      ...commissionDetail,
      date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      reportId: index + 1,
    }));

    await expect(
      shareVenueSummaryImage({ venue: buildVenue({ daily }), ...range }),
    ).rejects.toThrow(/Choose a shorter date range and try again/);
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });
});
