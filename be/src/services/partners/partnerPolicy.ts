import { createHash, randomBytes } from 'node:crypto';
import HttpError from '../../errors/HttpError.js';

export type PartnerAgreement = {
  productIds: number[];
  commissionPercent: number;
  paymentModes: Array<'platform' | 'partner' | 'arrival'>;
  creditLimit: number;
  connectSplit: boolean;
  allowCancellation: boolean;
  allowAmendment: boolean;
  allowRefunds: boolean;
  cancellationHours: number;
  allowedOrigins: string[];
};
export const defaultAgreement: PartnerAgreement = { productIds: [], commissionPercent: 0, paymentModes: ['platform'], creditLimit: 0, connectSplit: false, allowCancellation: false, allowAmendment: false, allowRefunds: false, cancellationHours: 24, allowedOrigins: [] };
export const opaqueToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
export const minor = (value: number): number => Math.round(value * 100);
export const positiveId = (value: unknown): number => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'A valid record ID is required.');
  return id;
};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const requestHash = (value: unknown): string => hashToken(JSON.stringify(canonical(value)));
export const parseAgreement = (input: unknown): PartnerAgreement => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'An agreement is required.');
  const x = input as Record<string, unknown>;
  const result = { ...defaultAgreement, ...x } as PartnerAgreement;
  if (Object.keys(x).some(key => !(key in defaultAgreement))) throw new HttpError(400, 'Unknown agreement field.');
  if (!Array.isArray(result.productIds) || result.productIds.length > 100) throw new HttpError(400, 'Select up to 100 approved products.');
  result.productIds = [...new Set(result.productIds.map(positiveId))];
  for (const [field, max] of [['commissionPercent', 100], ['creditLimit', 1000000], ['cancellationHours', 8760]] as const) {
    if (typeof result[field] !== 'number' || !Number.isFinite(result[field]) || result[field] < 0 || result[field] > max) throw new HttpError(400, `Invalid ${field}.`);
  }
  if (!Array.isArray(result.paymentModes) || !result.paymentModes.length || result.paymentModes.some(mode => !['platform', 'partner', 'arrival'].includes(mode))) throw new HttpError(400, 'Select supported payment arrangements.');
  for (const key of ['connectSplit', 'allowCancellation', 'allowAmendment', 'allowRefunds'] as const) if (typeof result[key] !== 'boolean') throw new HttpError(400, `Invalid ${key}.`);
  if (!Array.isArray(result.allowedOrigins) || result.allowedOrigins.length > 30) throw new HttpError(400, 'Invalid website origins.');
  result.allowedOrigins = [...new Set(result.allowedOrigins.map(origin => {
    try { const u = new URL(origin); if (u.protocol !== 'https:' || u.origin !== origin || u.username || u.password || !u.hostname.includes('.') || /[^a-z0-9.-]/i.test(u.hostname)) throw new Error(); return u.origin; }
    catch { throw new HttpError(400, 'Website origins must be exact HTTPS origins, for example https://partner.com.'); }
  }))];
  return result;
};
export const commissionAfterRefund = (total: number, commission: number, refunded: number): number => total > 0 ? money(commission * Math.max(0, total - refunded) / total) : 0;
export const assertIdempotentReplay = (previousHash: string, nextHash: string): void => {
  if (previousHash !== nextHash) throw new HttpError(409, 'This reference was already used for a different selection. Use a new reference.');
};
export const assertProducts = (agreement: PartnerAgreement, items: Array<{ productId: number }>): void => {
  if (!items.length || items.some(item => !agreement.productIds.includes(Number(item.productId)))) throw new HttpError(403, 'This selection contains a product outside the partner agreement.');
};
