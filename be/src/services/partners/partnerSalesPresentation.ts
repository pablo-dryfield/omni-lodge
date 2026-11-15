import { randomUUID } from 'node:crypto';
import HttpError from '../../errors/HttpError.js';
import { opaqueToken } from './partnerPolicy.js';

/** Presentation only: approval, prices and payment rules always come from the agreement. */
export type SalesAppearance = {
  showBrand: boolean; brandDisplay: 'name' | 'logo' | 'both'; logoUrl: string;
  showPoweredBy: boolean; poweredByText: string; showStepper: boolean;
  showEyebrow: boolean; eyebrow: string; showTitle: boolean; title: string;
  showDescription: boolean; description: string;
  showCount: boolean; hideSingleCount: boolean;
  showSecureBooking: boolean; secureBookingText: string;
  showPaymentTrust: boolean; paymentTrustText: string;
  showEmailTrust: boolean; emailTrustText: string;
  showPartnerTrust: boolean; partnerTrustText: string;
  entryMode: 'catalog' | 'single' | 'product'; entryProductId: number | null;
  productIds: number[] | null;
};
export type SalesLink = { id: string; code: string; name: string; active: boolean; overrides: Partial<SalesAppearance> };
export type SalesPageConfig = { defaults: Partial<SalesAppearance>; links: SalesLink[] };
export const salesAppearanceDefaults: SalesAppearance = {
  showBrand: true, brandDisplay: 'name', logoUrl: '', showPoweredBy: true,
  poweredByText: 'Booking powered by', showStepper: true,
  showEyebrow: true, eyebrow: 'GOOD DAYS. GREAT NIGHTS.', showTitle: true, title: 'Discover your next experience.',
  showDescription: true, description: 'Local favourites, unforgettable moments. Choose your experience and make it yours.',
  showCount: true, hideSingleCount: true, showSecureBooking: true, secureBookingText: 'Secure online booking',
  showPaymentTrust: true, paymentTrustText: 'Secure payment with Stripe',
  showEmailTrust: true, emailTrustText: 'Tickets delivered by email',
  showPartnerTrust: true, partnerTrustText: 'Selected by {partnerName}',
  entryMode: 'catalog', entryProductId: null, productIds: null,
};
const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, 'Page settings must be an object.');
  return x as Record<string, unknown>;
};
export function parseSalesAppearance(raw: unknown): Partial<SalesAppearance> {
  const input = object(raw), result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(salesAppearanceDefaults, key)) throw new HttpError(400, `Unknown page setting: ${key}.`);
    const fallback = salesAppearanceDefaults[key as keyof SalesAppearance];
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') throw new HttpError(400, `${key} must be true or false.`);
    } else if (key === 'brandDisplay' || key === 'entryMode') {
      if (!(key === 'brandDisplay' ? ['name', 'logo', 'both'] : ['catalog', 'single', 'product']).includes(value as string)) throw new HttpError(400, `Invalid ${key}.`);
    } else if (key === 'productIds') {
      if (value !== null && (!Array.isArray(value) || value.length > 200 || value.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(value).size !== value.length)) throw new HttpError(400, 'Choose distinct approved experiences.');
    } else if (key === 'entryProductId') {
      if (value !== null && (!Number.isSafeInteger(value) || Number(value) <= 0)) throw new HttpError(400, 'Choose an experience to open.');
    } else {
      const max = key === 'logoUrl' ? 2048 : key === 'description' ? 1000 : 160;
      if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `${key} must contain at most ${max} characters.`);
      result[key] = value.trim();
      if (key === 'logoUrl' && value.trim()) {
        let url: URL;
        try { url = new URL(value.trim()); } catch { throw new HttpError(400, 'Enter a valid logo URL.'); }
        if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new HttpError(400, 'Logo URLs must use HTTPS.');
      }
      continue;
    }
    result[key] = value;
  }
  return result as Partial<SalesAppearance>;
}
export function validateSalesAppearance(appearance: SalesAppearance, approved: number[]): void {
  if (appearance.productIds?.some(id => !approved.includes(id))) throw new HttpError(400, 'Page links can only use approved experiences.');
  if (appearance.productIds?.length === 0) throw new HttpError(400, 'Select at least one experience, or use all approved experiences.');
  if (appearance.entryMode === 'product' && (!appearance.entryProductId || !(appearance.productIds ?? approved).includes(appearance.entryProductId))) throw new HttpError(400, 'The experience to open must be included in this page.');
}
/** Unknown/disabled saved links fail closed rather than silently opening another page. */
export function resolveSalesPresentation(config: SalesPageConfig | null | undefined, code?: unknown) {
  let link: SalesLink | undefined;
  if (code !== undefined) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new HttpError(404, 'Booking link not found.');
    link = config?.links?.find(value => value.code === code && value.active);
    if (!link) throw new HttpError(404, 'This booking link is unavailable.');
  }
  return { appearance: { ...salesAppearanceDefaults, ...config?.defaults, ...link?.overrides }, link };
}
export function salesProductIds(approved: number[], appearance: SalesAppearance): number[] {
  return appearance.productIds === null ? approved : approved.filter(id => appearance.productIds!.includes(id));
}
export function parseSalesPageConfig(raw: unknown, current: SalesPageConfig | null, approved: number[]): SalesPageConfig {
  const input = object(raw), defaults = parseSalesAppearance(input.defaults);
  validateSalesAppearance({ ...salesAppearanceDefaults, ...defaults }, approved);
  if (!Array.isArray(input.links) || input.links.length > 50) throw new HttpError(400, 'A partner can have up to 50 saved booking links.');
  const seen = new Set<string>();
  const links = input.links.map(rawLink => {
    const row = object(rawLink);
    const existing = row.id ? current?.links?.find(link => link.id === row.id) : undefined;
    if (row.id && !existing) throw new HttpError(409, 'A saved link changed. Reload the page before saving.');
    if (existing && seen.has(existing.id)) throw new HttpError(400, 'Duplicate saved link.');
    if (existing) seen.add(existing.id);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100 || typeof row.active !== 'boolean') throw new HttpError(400, 'Each link needs a name and an enabled state.');
    const overrides = parseSalesAppearance(row.overrides);
    // Existing links may reference a product that management subsequently revoked.
    // Permit unrelated edits; public requests always intersect with current approvals.
    if (JSON.stringify(overrides) !== JSON.stringify(existing?.overrides) || JSON.stringify(defaults) !== JSON.stringify(current?.defaults)) validateSalesAppearance({ ...salesAppearanceDefaults, ...defaults, ...overrides }, approved);
    return { id: existing?.id ?? randomUUID(), code: existing?.code ?? opaqueToken(), name: row.name.trim(), active: row.active, overrides };
  });
  return { defaults, links };
}
export function salesLinkUrl(base: string, publicCode: string, linkCode?: string): string {
  const url = new URL(`/api/partner-sales/${encodeURIComponent(publicCode)}`, base);
  if (linkCode) url.searchParams.set('link', linkCode);
  return url.href;
}
