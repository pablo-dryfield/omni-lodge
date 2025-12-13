const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

export const isPhoneNumberValid = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("+")) {
    return false;
  }
  const digits = trimmed
    .slice(1)
    .replace(/\D/g, "")
    .trim();
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
};

export const normalizePhoneNumber = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("+")) {
    return trimmed;
  }
  const digits = trimmed
    .slice(1)
    .replace(/\D/g, "")
    .trim();
  return digits.length > 0 ? `+${digits}` : trimmed;
};

export { EMAIL_REGEX };

