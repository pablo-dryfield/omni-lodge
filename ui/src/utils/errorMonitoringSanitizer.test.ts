import {
  describeElement,
  redactCorrelationId,
  redactString,
  redactUrl,
  sanitizeForTelemetry,
} from "./errorMonitoringSanitizer";

describe("error monitoring privacy sanitizer", () => {
  it("redacts credentials and common personal data", () => {
    const source =
      "Bearer abc.def.ghi user@example.com password=hunter2 +48 555 444 333 4111 1111 1111 1111";
    const result = redactString(source);

    expect(result).not.toContain("abc.def.ghi");
    expect(result).not.toContain("user@example.com");
    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("555 444 333");
    expect(result).not.toContain("4111 1111 1111 1111");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts IBANs, bank account numbers, and finance fields", () => {
    const result = sanitizeForTelemetry({
      iban: "PL61109010140000071219812874",
      transactionAmount: 583.33,
      openingBalance: 602.42,
      note: "Transfer to DE89 3704 0044 0532 0130 00",
      displayText: "Paid 583.33 zł and € 120.00",
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("PL61109010140000071219812874");
    expect(serialized).not.toContain("583.33");
    expect(serialized).not.toContain("602.42");
    expect(serialized).not.toContain("DE89 3704 0044 0532 0130 00");
    expect(serialized).not.toContain("583.33 zł");
    expect(serialized).not.toContain("€ 120.00");
  });

  it("keeps URL structure while removing every query value and the fragment", () => {
    expect(
      redactUrl("https://omni-lodge.com/bookings?email=person@example.com&page=4#private"),
    ).toBe(
      "https://omni-lodge.com/bookings?email=[REDACTED]&page=[REDACTED]",
    );
  });

  it("redacts encoded personal data and record identifiers from URL paths", () => {
    const result = redactUrl(
      "/customers/person%2540example.com/orders/123/550e8400-e29b-41d4-a716-446655440000/abcDEF0123456789abcDEF012345?token=secret#private",
    );

    expect(result).not.toContain("person");
    expect(result).not.toContain("123");
    expect(result).not.toContain("550e8400");
    expect(result).not.toContain("abcDEF0123456789");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("private");
    expect(result).toContain("customers");
    expect(result).toContain("orders");
  });

  it("redacts opaque IDs in ordinary text but retains explicit correlation IDs", () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    expect(redactString(`Failed record ${requestId}`)).not.toContain(requestId);
    expect(redactCorrelationId(requestId)).toBe(requestId);
  });

  it("redacts sensitive object keys, limits collections, and handles cycles", () => {
    const payload: Record<string, unknown> = {
      password: "do-not-store",
      accessToken: "do-not-store-either",
      customerEmail: "private@example.com",
      guestPhone: "+48 555 444 333",
      firstName: "Private",
      safe: "visible",
      entries: Array.from({ length: 30 }, (_, index) => index),
    };
    payload.circular = payload;

    const result = sanitizeForTelemetry(payload) as Record<string, unknown>;
    expect(result.password).toBe("[REDACTED]");
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.customerEmail).toBe("[REDACTED]");
    expect(result.guestPhone).toBe("[REDACTED]");
    expect(result.firstName).toBe("[REDACTED]");
    expect(result.safe).toBe("visible");
    expect(result.circular).toBe("[Circular]");
    expect(result.entries).toHaveLength(20);
  });

  it("never invokes accessors and does not throw for hostile objects", () => {
    const getter = jest.fn(() => {
      throw new Error("must not run");
    });
    const withGetter = Object.defineProperty({ safe: "visible" }, "danger", {
      enumerable: true,
      get: getter,
    });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => sanitizeForTelemetry(withGetter)).not.toThrow();
    expect(sanitizeForTelemetry(withGetter)).toEqual({
      safe: "visible",
      danger: "[Accessor]",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(() => sanitizeForTelemetry(proxy)).not.toThrow();
  });

  it("applies a global traversal budget to oversized object graphs", () => {
    const payload = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `branch${index}`,
        Array.from({ length: 100 }, (_unused, child) => `value-${index}-${child}`),
      ]),
    );
    const result = sanitizeForTelemetry(payload, {
      maxNodes: 30,
      maxObjectKeys: 100,
      maxArrayItems: 100,
      maxTotalStringLength: 1_000,
    });
    expect(JSON.stringify(result).length).toBeLessThan(5_000);
    expect(JSON.stringify(result)).toContain("Telemetry budget exhausted");
  });

  it("describes a clicked control without collecting its value or text", () => {
    const input = document.createElement("input");
    input.id = "booking-search";
    input.type = "text";
    input.value = "private customer text";
    input.setAttribute("aria-label", "Search bookings");
    input.setAttribute("role", "searchbox");
    input.className = "customer-private-text";

    expect(describeElement(input)).toEqual({
      tag: "input",
      role: "searchbox",
      inputType: "text",
    });
    const serialized = JSON.stringify(describeElement(input));
    expect(serialized).not.toContain("private customer text");
    expect(serialized).not.toContain("Search bookings");
    expect(serialized).not.toContain("booking-search");
    expect(serialized).not.toContain("customer-private-text");
  });
});
