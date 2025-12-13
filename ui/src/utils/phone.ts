import { DEFAULT_PHONE_CODE, PHONE_CODE_VALUES_DESC } from "../constants/phoneCodes";

export const buildPhoneFromParts = (code: string, digits: string): string => {
  const sanitizedCode = code.trim();
  const sanitizedDigits = digits.replace(/\D/g, "");
  if (sanitizedCode.length === 0 || sanitizedDigits.length === 0) {
    return "";
  }
  return `${sanitizedCode}${sanitizedDigits}`;
};

export const splitPhoneNumber = (
  value: string | null | undefined,
): { code: string; digits: string } => {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return { code: DEFAULT_PHONE_CODE, digits: "" };
  }
  const normalized = trimmed.replace(/\s+/g, "");
  const matchedPrefix = PHONE_CODE_VALUES_DESC.find((prefix) => normalized.startsWith(prefix));
  if (!matchedPrefix) {
    const digitsOnly = normalized.replace(/\D/g, "");
    return {
      code: DEFAULT_PHONE_CODE,
      digits: digitsOnly,
    };
  }
  const digitsOnly = normalized.slice(matchedPrefix.length).replace(/\D/g, "");
  return {
    code: matchedPrefix,
    digits: digitsOnly,
  };
};
