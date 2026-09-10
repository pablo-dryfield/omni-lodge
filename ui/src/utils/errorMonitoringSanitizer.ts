const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const UNREADABLE = "[Unreadable]";
const SANITIZATION_FAILED = "[Sanitization failed]";
const BUDGET_EXHAUSTED = "[Telemetry budget exhausted]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set_cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "signature",
  "photo",
  "image",
  "file",
  "blob",
  "binary",
  "body",
  "payload",
  "card",
  "cvv",
  "cvc",
  "pin",
  "email",
  "phone",
  "address",
  "customer",
  "guest",
  "full_name",
  "first_name",
  "last_name",
  "username",
  "name",
  "user",
  "user_id",
  "staff",
  "staff_id",
  "employee",
  "employee_id",
  "account_holder",
  "beneficiary",
  "payer",
  "payee",
  "iban",
  "bic",
  "swift",
  "bank_account",
  "bank_account_number",
  "account_number",
  "routing_number",
  "sort_code",
  "payment_method",
  "amount",
  "balance",
  "salary",
  "wage",
  "compensation",
  "reimbursement",
  "payout",
  "revenue",
  "price",
  "unit_price",
  "cost",
  "subtotal",
  "grand_total",
]);
const SENSITIVE_QUERY_KEY = /(?:token|key|secret|password|code|signature|auth|session|email|phone|name|address|card|redirect|iban|account|bank|amount|payment)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_ASSIGNMENT = /\b(password|passwd|secret|token|api[_-]?key|authorization|iban|bank[_ -]?account|account[_ -]?number|routing[_ -]?number|swift|bic)\s*[:=]\s*([^\s,;]+)/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi;
const LONG_BANK_NUMBER = /\b(?:\d[ -]?){20,34}\b/g;
const PAYMENT_CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE = /(?:\+?\d[\d ().-]{7,}\d)/g;
const FINANCIAL_ASSIGNMENT = /\b(amount|balance|salary|wage|compensation|reimbursement|payout|revenue|price|cost|subtotal|grand[_ -]?total)\s*[:=]\s*(?:PLN|EUR|USD|GBP|z\u0142|\u20ac|\$)?\s*-?\d[\d .,]*/gi;
const CURRENCY_AMOUNT_PREFIX = /(?:\b(?:PLN|EUR|USD|GBP|CHF)\b|z\u0142|\u20ac|\$)\s*-?\d[\d .,]*/gi;
const CURRENCY_AMOUNT_SUFFIX = /\b-?\d[\d .,]*\s*(?:PLN|EUR|USD|GBP|CHF|z\u0142)(?![A-Za-z0-9])/gi;
const WINDOWS_USER_PATH = /([A-Z]:\\Users\\)[^\\/\s]+/gi;
const POSIX_USER_PATH = /(\/(?:home|Users)\/)[^/\s]+/g;
const QUERY_VALUE = /([?&][^=&#\s]{1,100}=)[^&#\s)\]]+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const OPAQUE_IDENTIFIER = /\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g;

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - TRUNCATED.length))}${TRUNCATED}`;

const isSensitiveKey = (key: string): boolean => {
  const normalized = key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    /(?:^|_)(?:email|phone|address|customer|guest|full_name|first_name|last_name|username)(?:_|$)/.test(
      normalized,
    ) ||
    /(?:^|_)(?:iban|bic|swift|bank_account|account_number|routing_number|sort_code|payment_method|amount|balance|salary|wage|compensation|reimbursement|payout|revenue|price|unit_price|cost|subtotal|grand_total)(?:_|$)/.test(
      normalized,
    ) ||
    /_(?:password|passwd|secret|token|signature|photo|image|blob|binary|payload|card|cvv|cvc|pin)$/.test(
      normalized,
    )
  );
};

const redactPersonalData = (value: string): string =>
  value
      .replace(BEARER, `Bearer ${REDACTED}`)
      .replace(JWT, REDACTED)
      .replace(EMAIL, REDACTED)
      .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`)
      .replace(QUERY_VALUE, `$1${REDACTED}`)
      .replace(IBAN, REDACTED)
      .replace(LONG_BANK_NUMBER, REDACTED)
      .replace(PAYMENT_CARD, REDACTED)
      .replace(PHONE, REDACTED)
      .replace(FINANCIAL_ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`)
      .replace(CURRENCY_AMOUNT_PREFIX, REDACTED)
      .replace(CURRENCY_AMOUNT_SUFFIX, REDACTED)
      .replace(WINDOWS_USER_PATH, `$1[USER]`)
      .replace(POSIX_USER_PATH, `$1[USER]`);

export const redactString = (value: string, maxLength = 2_000): string =>
  truncate(
    redactPersonalData(value)
      .replace(UUID, '[UUID]')
      .replace(OPAQUE_IDENTIFIER, '[OPAQUE-ID]'),
    maxLength,
  );

/** Correlation IDs are intentionally retained so client and server events can be joined. */
export const redactCorrelationId = (value: string, maxLength = 200): string =>
  /^[A-Za-z0-9._:-]{1,200}$/.test(value)
    ? truncate(value, maxLength)
    : truncate(redactPersonalData(value), maxLength);

const sanitizePathSegment = (segment: string): string => {
  if (!segment) return segment;
  let decoded = segment;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  if (redactPersonalData(decoded) !== decoded) return '[REDACTED]';
  if (/^\d+$/.test(decoded)) return '[NUMERIC-ID]';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) {
    return '[UUID]';
  }
  if (/^(?=.{20,}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._~-]+$/.test(decoded)) {
    return '[OPAQUE-ID]';
  }
  return segment;
};

export const redactUrl = (rawUrl: string | undefined): string | undefined => {
  if (!rawUrl) {
    return undefined;
  }

  if (/^(?:data|blob):/i.test(rawUrl)) {
    return `[${rawUrl.slice(0, rawUrl.indexOf(":")) || "embedded"}-url]`;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
    const parsed = new URL(rawUrl, base);
    const sanitizedPath = parsed.pathname.split('/').map(sanitizePathSegment).join('/');
    const sanitized = new URL(parsed.origin + sanitizedPath);
    parsed.searchParams.forEach((_value, key) => {
      sanitized.searchParams.append(key, SENSITIVE_QUERY_KEY.test(key) ? REDACTED : REDACTED);
    });
    const isRelative = !/^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl);
    const result = `${isRelative ? "" : sanitized.origin}${sanitized.pathname}${sanitized.search}`;
    return redactString(result, 2_000);
  } catch {
    const withoutQuery = rawUrl.replace(/[?#].*$/, "");
    return redactString(withoutQuery.split('/').map(sanitizePathSegment).join('/'), 2_000);
  }
};

type SanitizeOptions = {
  depth?: number;
  maxStringLength?: number;
  maxNodes?: number;
  maxTotalStringLength?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
};

const safeInstanceOf = (value: object, constructor: Function): boolean => {
  try {
    return value instanceof (constructor as FunctionConstructor);
  } catch {
    return false;
  }
};

const safeString = (value: unknown, fallback: string): string => {
  try {
    return typeof value === "string" ? value : String(value);
  } catch {
    return fallback;
  }
};

const normalizePrimitive = (
  value: unknown,
  maxStringLength: number,
  consumeString: (value: string, maxLength: number) => string,
): unknown => {
  if (typeof value === "string") {
    return consumeString(value, maxStringLength);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (typeof value === "bigint") {
    return consumeString(value.toString(), maxStringLength);
  }
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "symbol") {
    return consumeString(safeString(value, "[Symbol]"), maxStringLength);
  }
  if (typeof value === "function") {
    let name = "anonymous";
    try {
      name = value.name || name;
    } catch {
      // Proxied functions may throw while their name is inspected.
    }
    return consumeString(`[Function ${name}]`, maxStringLength);
  }
  return null;
};

export const sanitizeForTelemetry = (
  value: unknown,
  options: SanitizeOptions = {},
): unknown => {
  try {
    const maxDepth = Math.max(1, Math.min(10, options.depth ?? 5));
    const maxStringLength = Math.max(32, Math.min(12_000, options.maxStringLength ?? 2_000));
    const maxNodes = Math.max(20, Math.min(1_000, options.maxNodes ?? 250));
    const maxArrayItems = Math.max(1, Math.min(100, options.maxArrayItems ?? 20));
    const maxObjectKeys = Math.max(1, Math.min(100, options.maxObjectKeys ?? 40));
    let remainingStringCharacters = Math.max(
      1_000,
      Math.min(100_000, options.maxTotalStringLength ?? 32_000),
    );
    let remainingNodes = maxNodes;
    const seen = new WeakSet<object>();

    const consumeString = (candidate: string, perValueLimit: number): string => {
      if (remainingStringCharacters <= 0) return BUDGET_EXHAUSTED;
      let redacted: string;
      try {
        redacted = redactString(candidate, Math.min(perValueLimit, remainingStringCharacters));
      } catch {
        return SANITIZATION_FAILED;
      }
      remainingStringCharacters = Math.max(0, remainingStringCharacters - redacted.length);
      return redacted;
    };

    const safeProperty = (candidate: object, key: PropertyKey): unknown => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor) return UNREADABLE;
        // Never invoke application getters while reporting another error.
        return "value" in descriptor ? descriptor.value : "[Accessor]";
      } catch {
        return UNREADABLE;
      }
    };

    const visit = (candidate: unknown, depth: number): unknown => {
      if (remainingNodes <= 0) return BUDGET_EXHAUSTED;
      remainingNodes -= 1;
      if (typeof candidate !== "object" || candidate === null) {
        return normalizePrimitive(candidate, maxStringLength, consumeString);
      }
      try {
        if (seen.has(candidate)) return "[Circular]";
      } catch {
        return UNREADABLE;
      }
      if (depth >= maxDepth) return "[Max depth]";

      if (safeInstanceOf(candidate, Error)) {
        let name: unknown;
        let message: unknown;
        let stack: unknown;
        try {
          name = (candidate as Error).name;
          message = (candidate as Error).message;
          stack = (candidate as Error).stack;
        } catch {
          return UNREADABLE;
        }
        return {
          name: consumeString(safeString(name, "Error") || "Error", 200),
          message: consumeString(safeString(message, "Error"), maxStringLength),
          stack: typeof stack === "string" ? consumeString(stack, 12_000) : undefined,
        };
      }
      if (typeof Event !== "undefined" && safeInstanceOf(candidate, Event)) {
        let type = "event";
        try {
          type = (candidate as Event).type || type;
        } catch {
          // Retain the generic event type.
        }
        return { type: consumeString(type, 100) };
      }
      if (typeof Element !== "undefined" && safeInstanceOf(candidate, Element)) {
        return describeElement(candidate as Element);
      }

      try {
        seen.add(candidate);
      } catch {
        return UNREADABLE;
      }
      let isArray = false;
      try {
        isArray = Array.isArray(candidate);
      } catch {
        return UNREADABLE;
      }
      if (isArray) {
        const result: unknown[] = [];
        let length = 0;
        try {
          length = Math.min(Number((candidate as unknown[]).length) || 0, maxArrayItems);
        } catch {
          return UNREADABLE;
        }
        for (let index = 0; index < length; index += 1) {
          result.push(visit(safeProperty(candidate, index), depth + 1));
        }
        return result;
      }

      let keys: string[];
      try {
        keys = Reflect.ownKeys(candidate)
          .filter((key): key is string => typeof key === "string")
          .slice(0, maxObjectKeys);
      } catch {
        return UNREADABLE;
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (remainingNodes <= 0) {
          result[BUDGET_EXHAUSTED] = true;
          break;
        }
        const safeKey = consumeString(key, 100);
        result[safeKey] = isSensitiveKey(key)
          ? REDACTED
          : visit(safeProperty(candidate, key), depth + 1);
      }
      return result;
    };

    return visit(value, 0);
  } catch {
    // Error reporting must never become the source of a second application
    // failure, even for revoked Proxies or hostile browser objects.
    return SANITIZATION_FAILED;
  }
};

export const describeElement = (target: EventTarget | null): Record<string, unknown> => {
  try {
    if (
      typeof Element === "undefined" ||
      !target ||
      typeof target !== "object" ||
      !safeInstanceOf(target, Element)
    ) {
      return { element: "unknown" };
    }
    const element = target as Element;

    // Breadcrumbs deliberately avoid IDs, class names, labels and visible text.
    // Those fields are routinely populated with customer names, booking references,
    // search text, or other application data. Only stable semantic values from
    // small allowlists are useful enough to retain.
    const role = (element.getAttribute("role") || "").toLowerCase();
    const allowedRoles = new Set([
      "button",
      "checkbox",
      "combobox",
      "dialog",
      "link",
      "listbox",
      "menuitem",
      "navigation",
      "option",
      "radio",
      "searchbox",
      "switch",
      "tab",
    ]);
    const inputType =
      typeof HTMLInputElement !== "undefined" && safeInstanceOf(element, HTMLInputElement)
        ? ((element as HTMLInputElement).type || "").toLowerCase()
        : "";
    const allowedInputTypes = new Set([
      "button",
      "checkbox",
      "date",
      "datetime-local",
      "email",
      "file",
      "month",
      "number",
      "password",
      "radio",
      "range",
      "reset",
      "search",
      "submit",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ]);
    return {
      tag: element.tagName.toLowerCase(),
      role: allowedRoles.has(role) ? role : undefined,
      inputType: allowedInputTypes.has(inputType) ? inputType : undefined,
    };
  } catch {
    return { element: "unknown" };
  }
};

export const normalizeError = (
  value: unknown,
): { name: string; message: string; stack?: string; context?: unknown } => {
  if (value && typeof value === "object" && safeInstanceOf(value, Error)) {
    try {
      const candidate = value as Error;
      return {
        name: redactString(candidate.name || "Error", 200),
        message: redactString(candidate.message || safeString(candidate, "Error")),
        stack: candidate.stack ? redactString(candidate.stack, 12_000) : undefined,
      };
    } catch {
      return { name: "UnreadableError", message: UNREADABLE };
    }
  }
  if (typeof value === "string") {
    return { name: "Error", message: redactString(value) };
  }

  let serialized = "Unknown error";
  const context = sanitizeForTelemetry(value);
  try {
    serialized = JSON.stringify(context, null, 0) || serialized;
  } catch {
    // The normalized fallback deliberately contains no original object data.
  }
  return {
    name: "NonErrorThrown",
    message: redactString(serialized),
    context,
  };
};
