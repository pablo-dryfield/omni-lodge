import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export type NormalizedStorefrontPhone = {
  phone: string | null;
  countryCode: string | null;
};

export const normalizeStorefrontPhone = (
  phoneValue: string | null,
  countryCodeValue: string | null,
): NormalizedStorefrontPhone => {
  const phone = phoneValue?.trim() || null;
  const countryCode = countryCodeValue?.trim().toUpperCase() || null;
  if (!phone) return { phone: null, countryCode };

  const international = phone.startsWith('00')
    ? `+${phone.slice(2).replace(/\D/g, '')}`
    : phone.includes('+')
      ? `+${phone.slice(phone.indexOf('+') + 1).replace(/\D/g, '')}`
      : null;

  if (international) {
    const parsed = parsePhoneNumberFromString(international);
    if (parsed?.country) {
      return { phone: parsed.number, countryCode: parsed.country };
    }
    return { phone: international, countryCode };
  }

  if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
    try {
      const parsed = parsePhoneNumberFromString(phone, countryCode as CountryCode);
      if (parsed) return { phone: parsed.number, countryCode };
    } catch {
      // Preserve the submitted values for the controller's existing validation path.
    }
  }

  return { phone, countryCode };
};
