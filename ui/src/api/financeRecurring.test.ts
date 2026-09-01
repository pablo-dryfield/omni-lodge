import { normalizeRecurringOccurrenceList } from "./financeRecurring";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {},
}));

const occurrence = {
  id: 18,
  status: "planned",
};

describe("normalizeRecurringOccurrenceList", () => {
  it("accepts the paginated API response", () => {
    expect(normalizeRecurringOccurrenceList({
      data: [occurrence],
      meta: { count: 12, limit: 10, offset: 0 },
    })).toEqual({
      data: [occurrence],
      meta: { count: 12, limit: 10, offset: 0 },
    });
  });

  it("keeps compatibility with an array response", () => {
    expect(normalizeRecurringOccurrenceList([occurrence], 20, 40)).toEqual({
      data: [occurrence],
      meta: { count: 1, limit: 20, offset: 40 },
    });
  });

  it("rejects malformed responses instead of silently showing no history", () => {
    expect(() => normalizeRecurringOccurrenceList({ nope: [] })).toThrow(
      "did not include transactions",
    );
  });
});
