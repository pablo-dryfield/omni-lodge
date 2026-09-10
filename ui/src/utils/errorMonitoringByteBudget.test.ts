import {
  jsonUtf8ByteLength,
  selectUtf8EventBatch,
  utf8ByteLength,
} from "./errorMonitoringByteBudget";

describe("error monitoring UTF-8 byte budgets", () => {
  it("counts Unicode using its encoded byte size", () => {
    expect(utf8ByteLength("ASCII")).toBe(5);
    expect(utf8ByteLength("zł € 😀")).toBe(12);
  });

  it("keeps the serialized event envelope below the exclusive limit", () => {
    const items = [
      { id: "one", event: { message: "😀".repeat(8) } },
      { id: "two", event: { message: "small" } },
    ];
    const result = selectUtf8EventBatch(items, (item) => item.event, 10, 70);

    expect(result.selected.map((item) => item.id)).toEqual(["one"]);
    expect(utf8ByteLength(result.body)).toBeLessThan(70);
  });

  it("skips an individually unsendable head record and selects later diagnostics", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const items = [
      { id: "unicode", event: { message: "😀".repeat(20) } },
      { id: "circular", event: circular },
      { id: "later", event: { message: "still deliver me" } },
    ];
    const result = selectUtf8EventBatch(items, (item) => item.event, 10, 70);

    expect(result.individuallyUnsendable.map((item) => item.id)).toEqual([
      "unicode",
      "circular",
    ]);
    expect(result.selected.map((item) => item.id)).toEqual(["later"]);
    expect(utf8ByteLength(result.body)).toBeLessThan(70);
    expect(jsonUtf8ByteLength(circular)).toBe(Number.POSITIVE_INFINITY);
  });
});
