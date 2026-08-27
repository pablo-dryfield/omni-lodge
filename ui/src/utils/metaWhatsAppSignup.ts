export const META_WHATSAPP_SIGNUP_TYPE = "WA_EMBEDDED_SIGNUP" as const;
export const META_WHATSAPP_SIGNUP_FINISH_EVENT = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" as const;
export const META_WHATSAPP_SIGNUP_FEATURE = "whatsapp_business_app_onboarding" as const;
export const META_WHATSAPP_SESSION_INFO_VERSION = 3 as const;

const META_MESSAGE_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
]);
const META_SDK_ID = "facebook-jssdk";
const META_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const META_ID_PATTERN = /^\d{1,64}$/;
const SDK_LOAD_TIMEOUT_MS = 15_000;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  event: typeof META_WHATSAPP_SIGNUP_FINISH_EVENT;
  version: typeof META_WHATSAPP_SESSION_INFO_VERSION;
  data: {
    waba_id: string;
    phone_number_id?: string;
  };
};

export const parseWhatsAppEmbeddedSignupMessage = (
  message: Pick<MessageEvent<unknown>, "origin" | "data">,
): WhatsAppEmbeddedSignupSession | null => {
  if (!META_MESSAGE_ORIGINS.has(message.origin)) {
    return null;
  }

  const payload = parseMessageData(message.data);
  if (
    !payload
    || payload.type !== META_WHATSAPP_SIGNUP_TYPE
    || payload.event !== META_WHATSAPP_SIGNUP_FINISH_EVENT
    || !isRecord(payload.data)
  ) {
    return null;
  }

  const version = normalizeSessionVersion(payload.version);
  const wabaId = payload.data.waba_id;
  const phoneNumberId = payload.data.phone_number_id;
  if (
    version !== META_WHATSAPP_SESSION_INFO_VERSION
    || typeof wabaId !== "string"
    || !META_ID_PATTERN.test(wabaId)
    || (phoneNumberId !== undefined
      && (typeof phoneNumberId !== "string" || !META_ID_PATTERN.test(phoneNumberId)))
  ) {
    return null;
  }

  return {
    type: META_WHATSAPP_SIGNUP_TYPE,
    event: META_WHATSAPP_SIGNUP_FINISH_EVENT,
    version: META_WHATSAPP_SESSION_INFO_VERSION,
    data: {
      waba_id: wabaId,
      ...(typeof phoneNumberId === "string" ? { phone_number_id: phoneNumberId } : {}),
    },
  };
};

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
