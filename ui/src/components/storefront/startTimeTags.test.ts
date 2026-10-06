import { normalizeStartTimeTags } from "./startTimeTags";

describe("normalizeStartTimeTags", () => {
  it("keeps a spaced meridiem suffix with the start time", () => {
    expect(normalizeStartTimeTags(["5:00", "P.M."])).toEqual(["5:00 P.M."]);
  });

  it("keeps existing complete start-time tags intact", () => {
    expect(normalizeStartTimeTags(["5:00 P.M.", "10:30 A.M."])).toEqual([
      "5:00 P.M.",
      "10:30 A.M.",
    ]);
  });

  it("trims empty values while preserving ordinary time tags", () => {
    expect(normalizeStartTimeTags([" 21:00 ", "", "  10:00   PM  "])).toEqual([
      "21:00",
      "10:00 PM",
    ]);
  });
});
