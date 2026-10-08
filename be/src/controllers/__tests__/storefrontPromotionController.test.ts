import type { Request, Response } from 'express';
import StorefrontPromotion from '../../models/StorefrontPromotion.js';
import { createPromotion, updatePromotion, listPromotions, importEcwidPromotions, pushPromotionToEcwid } from '../storefrontPromotionController.js';
import { createEcwidDiscountCoupon, fetchAllEcwidDiscountCoupons } from '../../services/ecwidService.js';

jest.mock('../../models/StorefrontPromotion.js', () => ({ __esModule: true, default: {
  findAll: jest.fn(), findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn(),
} }));
jest.mock('../../services/ecwidService.js', () => ({
  createEcwidDiscountCoupon: jest.fn(), fetchAllEcwidDiscountCoupons: jest.fn(), updateEcwidDiscountCoupon: jest.fn(),
}));

const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};
const existing = () => ({ id: 1, code: 'SAVE', name: 'Save', type: 'fixed', value: 10, currency: 'PLN', minSubtotal: 0, metadata: { productIds: [28] }, update: jest.fn(), save: jest.fn() });
const request = (body: object) => ({ body, params: { id: '1' } } as unknown as Request);

beforeEach(() => {
  jest.resetAllMocks();
  (StorefrontPromotion.findOne as jest.Mock).mockResolvedValue(null);
  (StorefrontPromotion.create as jest.Mock).mockImplementation(async (payload) => ({ id: 2, ...payload }));
});

it('creates and serializes per-person tour-only rules in existing metadata', async () => {
  const res = response();
  await createPromotion(request({ code: 'ten', name: 'Ten', type: 'fixed', value: 10, applicationBasis: 'person', discountScope: 'tour', productIds: [28] }), res);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ applicationBasis: 'person', discountScope: 'tour', productIds: [28] }) });
});

it('preserves legacy defaults and unrelated metadata when editing', async () => {
  const row = existing();
  (StorefrontPromotion.findByPk as jest.Mock).mockResolvedValue(row);
  await updatePromotion(request({ name: 'Updated' }), response());
  expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ metadata: { productIds: [28], applicationBasis: 'booking', discountScope: 'tour_and_addons' } }));
});

it.each([{ applicationBasis: 'item' }, { discountScope: 'all' }])('rejects invalid calculation settings before writing: %s', async (invalid) => {
  const res = response();
  await createPromotion(request({ code: 'SAVE', name: 'Save', type: 'fixed', value: 10, ...invalid }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(StorefrontPromotion.create).not.toHaveBeenCalled();
});

it('returns backward-compatible defaults when listing old codes', async () => {
  (StorefrontPromotion.findAll as jest.Mock).mockResolvedValue([existing()]);
  const res = response();
  await listPromotions(request({}), res);
  expect(res.json).toHaveBeenCalledWith({ data: [expect.objectContaining({ applicationBasis: 'booking', discountScope: 'tour_and_addons' })] });
});

it('rejects incompatible Ecwid sync before creating or updating the local code', async () => {
  const row = existing();
  (StorefrontPromotion.findByPk as jest.Mock).mockResolvedValue(row);
  const payload = { code: 'SAVE', name: 'Save', type: 'fixed', value: 10, applicationBasis: 'person', syncToEcwid: true };
  await createPromotion(request(payload), response());
  await updatePromotion(request(payload), response());
  expect(StorefrontPromotion.create).not.toHaveBeenCalled();
  expect(row.update).not.toHaveBeenCalled();
  expect(createEcwidDiscountCoupon).not.toHaveBeenCalled();
});

it('rejects direct Ecwid push for tour-only codes', async () => {
  (StorefrontPromotion.findByPk as jest.Mock).mockResolvedValue({ ...existing(), metadata: { discountScope: 'tour' } });
  const res = response();
  await pushPromotionToEcwid(request({}), res);
  expect(res.status).toHaveBeenCalledWith(502);
  expect(createEcwidDiscountCoupon).not.toHaveBeenCalled();
});

it('does not overwrite local per-person settings or values during an Ecwid import', async () => {
  const row = { ...existing(), metadata: { applicationBasis: 'person' } };
  (StorefrontPromotion.findAll as jest.Mock).mockResolvedValue([row]);
  (fetchAllEcwidDiscountCoupons as jest.Mock).mockResolvedValue([{ code: 'SAVE', name: 'Old', discountType: 'ABS', discount: 5 }]);
  const res = response();
  await importEcwidPromotions(request({}), res);
  expect(row.update).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ created: 0, updated: 0, skipped: 1 });
});
