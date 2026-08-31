import dayjs from "dayjs";

type MoneyFormatOptions = {
  locale?: string;
  showSign?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

const formatMoney = (
  amount: number,
  currency: string,
  {
    locale = "en-GB",
    showSign = false,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  }: MoneyFormatOptions = {},
): string => {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCurrency = currency.trim().toUpperCase() || "PLN";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safeCurrency,
      currencyDisplay: "code",
      signDisplay: showSign ? "always" : "auto",
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(safeAmount);
  } catch {
    const sign = showSign && safeAmount > 0 ? "+" : "";
    return `${sign}${safeAmount.toFixed(maximumFractionDigits)} ${safeCurrency}`;
  }
};

export const formatFinanceMoneyMinor = (
  amountMinor: number,
  currency: string,
  options?: MoneyFormatOptions,
): string => formatMoney(Number(amountMinor) / 100, currency, options);

export const formatFinanceMoneyMajor = (
  amount: number,
  currency: string,
  options?: MoneyFormatOptions,
): string => formatMoney(Number(amount), currency, options);

export const formatFinanceDate = (
  value: string | Date | number | null | undefined,
  includeTime = false,
): string => {
  if (value == null || value === "") {
    return "—";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format(includeTime ? "DD MMM YYYY, HH:mm" : "DD MMM YYYY") : "—";
};

export const humanizeFinanceValue = (value: string | null | undefined): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "—";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

export const getFinanceErrorMessage = (error: unknown, fallback: string): string => {
  const responseData = (error as { response?: { data?: unknown } } | null)?.response?.data;
  const responseCandidate = Array.isArray(responseData) ? responseData[0] : responseData;
  if (responseCandidate && typeof responseCandidate === "object" && "message" in responseCandidate) {
    const responseMessage = (responseCandidate as { message?: unknown }).message;
    if (typeof responseMessage === "string" && responseMessage.trim()) {
      return responseMessage;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
};
