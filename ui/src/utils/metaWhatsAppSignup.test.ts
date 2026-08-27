import {
  META_WHATSAPP_SESSION_INFO_VERSION,
  META_WHATSAPP_SIGNUP_FINISH_EVENT,
  META_WHATSAPP_SIGNUP_TYPE,
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

  it.each([
    ["untrusted origin", "https://example.com", validPayload],
    ["wrong type", "https://www.facebook.com", { ...validPayload, type: "OTHER" }],
    ["wrong event", "https://www.facebook.com", { ...validPayload, event: "FINISH" }],
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
