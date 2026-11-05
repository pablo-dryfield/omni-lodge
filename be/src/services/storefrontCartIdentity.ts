import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import type { StorefrontCartInput } from './storefrontCommerceService.js';

export type CartCustomerIdentity = { email?: unknown; phone?: unknown; phoneCountry?: unknown; fullName?: unknown };

export const normalizedCartEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase();
export const normalizedCartName = (value: unknown): string => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const normalizedCartPhone = (customer: CartCustomerIdentity): string => {
  const value = String(customer.phone ?? '').trim();
  if (!value) return '';
  try {
    const country = String(customer.phoneCountry ?? '').toUpperCase();
    const international = value.replace(/^00/, '+');
    const parsed = parsePhoneNumberFromString(international, !international.startsWith('+') && country ? country as CountryCode : undefined);
    if (parsed?.isPossible()) return parsed.number;
  } catch { /* Incomplete contact details must not identify another customer. */ }
  return '';
};

export const cartIdentityMatches = (left: CartCustomerIdentity, right: CartCustomerIdentity) => {
  const email = normalizedCartEmail(left.email);
  const phone = normalizedCartPhone(left);
  const name = normalizedCartName(left.fullName);
  return {
    email: Boolean(email && email === normalizedCartEmail(right.email)),
    phone: Boolean(phone && phone === normalizedCartPhone(right)),
    name: Boolean(name && name === normalizedCartName(right.fullName)),
  };
};

type Candidate = { customer: CartCustomerIdentity };
export function resolveCartIdentity<T extends Candidate>(customer: CartCustomerIdentity, candidates: T[]) {
  const matches = candidates.map(cart => ({ cart, matches: cartIdentityMatches(customer, cart.customer) }));
  const emails = matches.filter(entry => entry.matches.email);
  const phones = matches.filter(entry => entry.matches.phone);
  // Never combine email-only matches with another person's phone-only matches.
  if (emails.length) return { kind: 'matched' as const, matchedBy: 'email' as const, carts: emails.map(entry => entry.cart) };
  if (phones.length) return { kind: 'matched' as const, matchedBy: 'phone' as const, carts: phones.map(entry => entry.cart) };
  const names = matches.filter(entry => entry.matches.name).map(entry => entry.cart);
  return { kind: names.length ? 'name_only' as const : 'none' as const, matchedBy: 'name' as const, carts: names };
}

// Guest-count changes, contact edits, discounts and add-ons do not create a new
// recovery opportunity once this customer's same product/date/time is booked.
export function sameCartExperiences(left: StorefrontCartInput, right: StorefrontCartInput): boolean {
  const signature = (cart: StorefrontCartInput) => {
    if (!cart.items?.length) return null;
    const experiences = new Set<string>();
    for (const item of cart.items) {
      const productId = Number(item.productId);
      const date = String(item.experienceDate ?? '').trim();
      const time = String(item.experienceTime ?? '').trim().slice(0, 5);
      if (!productId || !date || !time) return null;
      experiences.add(JSON.stringify([productId, date, time]));
    }
    return JSON.stringify([...experiences].sort());
  };
  const a = signature(left), b = signature(right);
  return Boolean(a && b && a === b);
}
