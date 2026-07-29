import { Request, Response } from 'express';
import { Op } from 'sequelize';
import StorefrontPromotion from '../models/StorefrontPromotion.js';
import {
  createEcwidDiscountCoupon,
  fetchAllEcwidDiscountCoupons,
  updateEcwidDiscountCoupon,
  type EcwidDiscountCoupon,
  type EcwidDiscountCouponPayload,
} from '../services/ecwidService.js';

type PromotionPayload = {
  code?: string;
  name?: string;
  type?: 'percentage' | 'fixed';
  value?: number;
  currency?: string | null;
  minSubtotal?: number;
  maxRedemptions?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  isActive?: boolean;
  productIds?: number[];
};

const serialize = (promotion: StorefrontPromotion) => ({
  id: promotion.id,
  code: promotion.code,
  name: promotion.name,
  type: promotion.type,
  value: Number(promotion.value),
  currency: promotion.currency,
  minSubtotal: Number(promotion.minSubtotal),
  maxRedemptions: promotion.maxRedemptions,
  redemptionCount: promotion.redemptionCount,
  validFrom: promotion.validFrom,
  validTo: promotion.validTo,
  isActive: promotion.isActive,
  productIds: Array.isArray(promotion.metadata?.productIds) ? promotion.metadata.productIds : [],
  ecwidCouponId: Number(promotion.metadata?.ecwidCouponId) || null,
  ecwidStatus: promotion.metadata?.ecwidStatus ?? null,
  ecwidLastSyncedAt: promotion.metadata?.ecwidLastSyncedAt ?? null,
  createdAt: promotion.createdAt,
  updatedAt: promotion.updatedAt,
});

const normalizePayload = (body: PromotionPayload, existing?: StorefrontPromotion) => {
  const code = String(body.code ?? existing?.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? existing?.name ?? '').trim();
  const type = body.type ?? existing?.type;
  const value = Number(body.value ?? existing?.value);
  if (!code || !name || !['percentage', 'fixed'].includes(String(type))) {
    throw new Error('Code, name, and discount type are required.');
  }
  if (!Number.isFinite(value) || value <= 0 || (type === 'percentage' && value > 100)) {
    throw new Error('Discount value must be positive and percentages cannot exceed 100.');
  }
  const productIds = body.productIds ?? (
    Array.isArray(existing?.metadata?.productIds) ? existing.metadata.productIds as number[] : []
  );
  return {
    code,
    name,
    type: type as 'percentage' | 'fixed',
    value,
    currency: type === 'fixed' ? String(body.currency ?? existing?.currency ?? 'PLN').toUpperCase() : null,
    minSubtotal: Math.max(0, Number(body.minSubtotal ?? existing?.minSubtotal ?? 0)),
    maxRedemptions:
      body.maxRedemptions === null || body.maxRedemptions === undefined
        ? body.maxRedemptions === null ? null : existing?.maxRedemptions ?? null
        : Math.max(1, Math.floor(Number(body.maxRedemptions))),
    validFrom: body.validFrom === undefined ? existing?.validFrom ?? null : body.validFrom ? new Date(body.validFrom) : null,
    validTo: body.validTo === undefined ? existing?.validTo ?? null : body.validTo ? new Date(body.validTo) : null,
    isActive: body.isActive ?? existing?.isActive ?? true,
    metadata: { ...(existing?.metadata ?? {}), productIds },
  };
};

const ecwidPayload = (promotion: StorefrontPromotion): EcwidDiscountCouponPayload => ({
  name: promotion.name,
  code: promotion.code,
  discountType: promotion.type === 'percentage' ? 'PERCENT' : 'ABS',
  status: promotion.isActive ? 'ACTIVE' : 'PAUSED',
  discount: Number(promotion.value),
  ...(promotion.validFrom ? { launchDate: promotion.validFrom.toISOString() } : {}),
  ...(promotion.validTo ? { expirationDate: promotion.validTo.toISOString() } : {}),
  totalLimit: Number(promotion.minSubtotal),
  usesLimit: promotion.maxRedemptions === 1 ? 'SINGLE' : 'UNLIMITED',
  applicationLimit: 'UNLIMITED',
});

const syncOneToEcwid = async (promotion: StorefrontPromotion) => {
  const existingId = Number(promotion.metadata?.ecwidCouponId) || null;
  let ecwidCouponId = existingId;
  if (existingId) {
    await updateEcwidDiscountCoupon(existingId, ecwidPayload(promotion));
  } else {
    const created = await createEcwidDiscountCoupon(ecwidPayload(promotion));
    ecwidCouponId = created.id;
  }
  promotion.metadata = {
    ...(promotion.metadata ?? {}),
    ecwidCouponId,
    ecwidStatus: promotion.isActive ? 'ACTIVE' : 'PAUSED',
    ecwidLastSyncedAt: new Date().toISOString(),
  };
  await promotion.save();
  return promotion;
};

const ecwidToLocal = (coupon: EcwidDiscountCoupon, existing?: StorefrontPromotion) => ({
  code: coupon.code.trim().toUpperCase(),
  name: coupon.name,
  type: coupon.discountType === 'PERCENT' ? 'percentage' as const : 'fixed' as const,
  value: Number(coupon.discount),
  currency: coupon.discountType === 'PERCENT' ? null : existing?.currency ?? 'PLN',
  minSubtotal: Number(coupon.totalLimit ?? 0),
  maxRedemptions: coupon.usesLimit === 'SINGLE' ? 1 : null,
  redemptionCount: Math.max(existing?.redemptionCount ?? 0, Number(coupon.orderCount ?? 0)),
  validFrom: coupon.launchDate ? new Date(coupon.launchDate) : null,
  validTo: coupon.expirationDate ? new Date(coupon.expirationDate) : null,
  isActive: coupon.status === 'ACTIVE',
  metadata: {
    ...(existing?.metadata ?? {}),
    ecwidCouponId: coupon.id,
    ecwidStatus: coupon.status,
    ecwidLastSyncedAt: new Date().toISOString(),
    ecwidCatalogLimit: coupon.catalogLimit ?? null,
  },
});

export const listPromotions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await StorefrontPromotion.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ data: rows.map(serialize) });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load promotions' });
  }
};

export const createPromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const promotion = await StorefrontPromotion.create(normalizePayload(req.body));
    if (req.body.syncToEcwid === true) await syncOneToEcwid(promotion);
    res.status(201).json({ data: serialize(promotion) });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to create promotion' });
  }
};

export const updatePromotion = async (req: Request, res: Response): Promise<void> => {
  try {
    const promotion = await StorefrontPromotion.findByPk(req.params.id);
    if (!promotion) { res.status(404).json({ message: 'Promotion not found' }); return; }
    await promotion.update(normalizePayload(req.body, promotion));
    if (req.body.syncToEcwid === true) await syncOneToEcwid(promotion);
    res.json({ data: serialize(promotion) });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to update promotion' });
  }
};

export const deletePromotion = async (req: Request, res: Response): Promise<void> => {
  const deleted = await StorefrontPromotion.destroy({ where: { id: req.params.id } });
  res.status(deleted ? 204 : 404).send();
};

export const pushPromotionToEcwid = async (req: Request, res: Response): Promise<void> => {
  try {
    const promotion = await StorefrontPromotion.findByPk(req.params.id);
    if (!promotion) { res.status(404).json({ message: 'Promotion not found' }); return; }
    await syncOneToEcwid(promotion);
    res.json({ data: serialize(promotion) });
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'Ecwid sync failed' });
  }
};

export const importEcwidPromotions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const coupons = await fetchAllEcwidDiscountCoupons();
    const supported = coupons.filter((coupon) => ['ABS', 'PERCENT'].includes(coupon.discountType));
    const existing = await StorefrontPromotion.findAll({
      where: { code: { [Op.in]: supported.map((coupon) => coupon.code.trim().toUpperCase()) } },
    });
    const byCode = new Map(existing.map((row) => [row.code.toUpperCase(), row]));
    let created = 0;
    let updated = 0;
    for (const coupon of supported) {
      const code = coupon.code.trim().toUpperCase();
      const row = byCode.get(code);
      if (row) {
        await row.update(ecwidToLocal(coupon, row));
        updated += 1;
      } else {
        await StorefrontPromotion.create(ecwidToLocal(coupon));
        created += 1;
      }
    }
    res.json({ created, updated, skipped: coupons.length - supported.length });
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'Ecwid import failed' });
  }
};
