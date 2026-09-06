export const META_WHATSAPP_SIGNUP_TYPE = "WA_EMBEDDED_SIGNUP" as const;
export const META_WHATSAPP_SIGNUP_FINISH_EVENT = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" as const;
export const META_WHATSAPP_SIGNUP_DEFAULT_FINISH_EVENT = "FINISH" as const;
export const META_WHATSAPP_SIGNUP_FEATURE = "whatsapp_business_app_onboarding" as const;
export const META_WHATSAPP_SESSION_INFO_VERSION = 3 as const;
export const META_WHATSAPP_SESSION_INFO_VERSION_PARAMETER = "3" as const;
export const META_WHATSAPP_EMBEDDED_SIGNUP_VERSION = "v4" as const;

const META_SDK_ID = "facebook-jssdk";
const META_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const META_ID_PATTERN = /^\d{1,64}$/;
const SDK_LOAD_TIMEOUT_MS = 15_000;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTrustedMetaMessageOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:"
      && (parsed.hostname === "facebook.com" || parsed.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
};

const parseMessageData = (value: unknown): UnknownRecord | null => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeSessionVersion = (value: unknown): number | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export type WhatsAppEmbeddedSignupSession = {
  type: typeof META_WHATSAPP_SIGNUP_TYPE;
  event: typeof META_WHATSAPP_SIGNUP_FINISH_EVENT | typeof META_WHATSAPP_SIGNUP_DEFAULT_FINISH_EVENT;
  version: typeof META_WHATSAPP_SESSION_INFO_VERSION;
  data: {
    waba_id: string;
    phone_number_id?: string;
  };
};

export type WhatsAppEmbeddedSignupDiagnosticCode =
  | "accepted"
  | "rejected_event"
  | "rejected_data"
  | "rejected_version"
  | "rejected_waba"
  | "rejected_phone";

export type WhatsAppEmbeddedSignupInspection = {
  session: WhatsAppEmbeddedSignupSession | null;
  diagnosticCode: WhatsAppEmbeddedSignupDiagnosticCode;
};

export const inspectWhatsAppEmbeddedSignupMessage = (
  message: Pick<MessageEvent<unknown>, "origin" | "data">,
): WhatsAppEmbeddedSignupInspection | null => {
  if (!isTrustedMetaMessageOrigin(message.origin)) {
    return null;
  }

  const payload = parseMessageData(message.data);
  if (!payload || payload.type !== META_WHATSAPP_SIGNUP_TYPE) {
    return null;
  }

  const finishEvent = payload?.event;
  if (finishEvent !== META_WHATSAPP_SIGNUP_FINISH_EVENT
    && finishEvent !== META_WHATSAPP_SIGNUP_DEFAULT_FINISH_EVENT) {
    return { session: null, diagnosticCode: "rejected_event" };
  }
  if (!isRecord(payload.data)) {
    return { session: null, diagnosticCode: "rejected_data" };
  }

  const version = normalizeSessionVersion(payload.version);
  const wabaId = payload.data.waba_id;
  const phoneNumberId = payload.data.phone_number_id;
  // Meta's Coexistence guide shows version 3, while its generic completion
  // schema and current reference client omit the field. Accept omission only;
  // explicit unknown versions remain rejected.
  if (payload.version !== undefined && version !== META_WHATSAPP_SESSION_INFO_VERSION) {
    return { session: null, diagnosticCode: "rejected_version" };
  }
  if (typeof wabaId !== "string" || !META_ID_PATTERN.test(wabaId)) {
    return { session: null, diagnosticCode: "rejected_waba" };
  }
  if (phoneNumberId !== undefined && phoneNumberId !== null
    && (typeof phoneNumberId !== "string" || !META_ID_PATTERN.test(phoneNumberId))) {
    return { session: null, diagnosticCode: "rejected_phone" };
  }

  return {
    diagnosticCode: "accepted",
    session: {
      type: META_WHATSAPP_SIGNUP_TYPE,
      event: finishEvent,
      version: META_WHATSAPP_SESSION_INFO_VERSION,
      data: {
        waba_id: wabaId,
        ...(typeof phoneNumberId === "string" ? { phone_number_id: phoneNumberId } : {}),
      },
    },
  };
};

export const parseWhatsAppEmbeddedSignupMessage = (
  message: Pick<MessageEvent<unknown>, "origin" | "data">,
): WhatsAppEmbeddedSignupSession | null =>
  inspectWhatsAppEmbeddedSignupMessage(message)?.session ?? null;

let sdkLoadPromise: Promise<MetaFacebookSdk> | null = null;

const initializeSdk = (
  sdk: MetaFacebookSdk,
  options: { appId: string; graphApiVersion: string },
): MetaFacebookSdk => {
  sdk.init({
    appId: options.appId,
    autoLogAppEvents: false,
    cookie: false,
    xfbml: false,
    version: options.graphApiVersion,
  });
  return sdk;
};

export const loadMetaFacebookSdk = (options: {
  appId: string;
  graphApiVersion: string;
}): Promise<MetaFacebookSdk> => {
  if (window.FB) {
    return Promise.resolve(initializeSdk(window.FB, options));
  }
  if (sdkLoadPromise) {
    return sdkLoadPromise.then((sdk) => initializeSdk(sdk, options));
  }

  sdkLoadPromise = new Promise<MetaFacebookSdk>((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;
    const finish = (sdk: MetaFacebookSdk) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(initializeSdk(sdk, options));
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      sdkLoadPromise = null;
      reject(new Error("Meta could not be loaded. Check the browser content policy and try again."));
    };
    timeoutId = window.setTimeout(fail, SDK_LOAD_TIMEOUT_MS);

    const previousAsyncInit = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      previousAsyncInit?.();
      if (window.FB) finish(window.FB);
      else fail();
    };

    const existing = document.getElementById(META_SDK_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => (window.FB ? finish(window.FB) : undefined), { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = META_SDK_ID;
    script.src = META_SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("error", fail, { once: true });
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
};
