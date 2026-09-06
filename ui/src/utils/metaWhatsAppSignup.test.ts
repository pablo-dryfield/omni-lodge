import {
  META_WHATSAPP_SESSION_INFO_VERSION,
  META_WHATSAPP_SIGNUP_DEFAULT_FINISH_EVENT,
  META_WHATSAPP_SIGNUP_FINISH_EVENT,
  META_WHATSAPP_SIGNUP_TYPE,
  inspectWhatsAppEmbeddedSignupMessage,
  parseWhatsAppEmbeddedSignupMessage,
} from "./metaWhatsAppSignup";

const validPayload = {
  type: META_WHATSAPP_SIGNUP_TYPE,
  event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
  version: META_WHATSAPP_SESSION_INFO_VERSION,
  data: {
    waba_id: "123456789012345",
    phone_number_id: "987654321098765",
    ignored_field: "not-forwarded",
  },
  ignored_top_level: "not-forwarded",
};

describe("parseWhatsAppEmbeddedSignupMessage", () => {
  it("accepts only the allowlisted completion fields from a trusted Meta origin", () => {
    expect(parseWhatsAppEmbeddedSignupMessage({
      origin: "https://www.facebook.com",
      data: validPayload,
    })).toEqual({
      type: META_WHATSAPP_SIGNUP_TYPE,
      event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
      version: META_WHATSAPP_SESSION_INFO_VERSION,
      data: {
        waba_id: "123456789012345",
        phone_number_id: "987654321098765",
      },
    });
  });

  it("accepts JSON session messages from web.facebook.com", () => {
    expect(parseWhatsAppEmbeddedSignupMessage({
      origin: "https://web.facebook.com",
      data: JSON.stringify({
        ...validPayload,
        data: { waba_id: "123456789012345" },
      }),
    })?.data).toEqual({ waba_id: "123456789012345" });
  });

  it("accepts session messages from Meta's business.facebook.com surface", () => {
    expect(parseWhatsAppEmbeddedSignupMessage({
      origin: "https://business.facebook.com",
      data: validPayload,
    })?.data).toEqual({
      waba_id: "123456789012345",
      phone_number_id: "987654321098765",
    });
  });

  it("accepts Meta's documented default finish payload for server-side Coexistence verification", () => {
    expect(parseWhatsAppEmbeddedSignupMessage({
      origin: "https://business.facebook.com",
      data: {
        type: META_WHATSAPP_SIGNUP_TYPE,
        event: META_WHATSAPP_SIGNUP_DEFAULT_FINISH_EVENT,
        version: "3",
        data: { waba_id: "123456789012345", phone_number_id: null },
      },
    })).toEqual({
      type: META_WHATSAPP_SIGNUP_TYPE,
      event: META_WHATSAPP_SIGNUP_DEFAULT_FINISH_EVENT,
      version: 3,
      data: { waba_id: "123456789012345" },
    });
  });

  it.each([
    ["unsupported event", { ...validPayload, event: "FINISH_ONLY_WABA" }, "rejected_event"],
    ["cancel event", { ...validPayload, event: "CANCEL" }, "rejected_event"],
    ["error event", { ...validPayload, event: "ERROR" }, "rejected_event"],
    ["missing data", { ...validPayload, data: null }, "rejected_data"],
    ["missing version", { ...validPayload, version: undefined }, "rejected_version"],
    ["wrong version", { ...validPayload, version: 4 }, "rejected_version"],
    ["invalid WABA", { ...validPayload, data: { waba_id: "waba-1" } }, "rejected_waba"],
    [
      "invalid phone",
      { ...validPayload, data: { waba_id: "123", phone_number_id: "phone-1" } },
      "rejected_phone",
    ],
  ])("returns only a sanitized diagnostic for %s", (_label, data, diagnosticCode) => {
    expect(inspectWhatsAppEmbeddedSignupMessage({
      origin: "https://business.facebook.com",
      data,
    })).toEqual({ session: null, diagnosticCode });
  });

  it.each([
    ["opaque origin", "null", validPayload],
    ["untrusted origin", "https://example.com", validPayload],
    ["lookalike origin", "https://evilfacebook.com", validPayload],
    ["insecure Meta origin", "http://business.facebook.com", validPayload],
    ["wrong type", "https://www.facebook.com", { ...validPayload, type: "OTHER" }],
    ["wrong event", "https://www.facebook.com", { ...validPayload, event: "UNKNOWN_FINISH" }],
    ["wrong version", "https://www.facebook.com", { ...validPayload, version: 4 }],
    [
      "non-numeric WABA id",
      "https://www.facebook.com",
      { ...validPayload, data: { waba_id: "waba-1" } },
    ],
    [
      "non-numeric phone id",
      "https://www.facebook.com",
      { ...validPayload, data: { waba_id: "123", phone_number_id: "phone-1" } },
    ],
  ])("rejects %s", (_label, origin, data) => {
    expect(parseWhatsAppEmbeddedSignupMessage({ origin, data })).toBeNull();
  });
});
