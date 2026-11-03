jest.mock('../../../models/Product.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../localBookingActionPolicy.js', () => ({ assertBookingManagementAccess: jest.fn() }));
import Product from '../../../models/Product.js';
import type Booking from '../../../models/Booking.js';
import type { AuthenticatedRequest } from '../../../types/AuthenticatedRequest.js';
import HttpError from '../../../errors/HttpError.js';
import { assertBookingManagementAccess } from '../../localBookingActionPolicy.js';
import { resolveBookingAmendmentProduct } from '../bookingAmendmentProductService.js';

const req = {} as AuthenticatedRequest;
const booking = { productId: 10, productName: 'Original tour' } as Booking;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(assertBookingManagementAccess).mockResolvedValue('STOREFRONT');
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 20, name: 'New tour', status: true } as Product);
});
it('uses the canonical product and checks management scope on both sides of the move', async () => {
  const product = await resolveBookingAmendmentProduct(req, booking, 20);
  expect(product?.name).toBe('New tour');
  expect(assertBookingManagementAccess).toHaveBeenNthCalledWith(1, req, booking, undefined);
  expect(assertBookingManagementAccess).toHaveBeenNthCalledWith(2, req, { productId: 20 }, undefined);
});
it('blocks moving a scoped booking to an unauthorized product', async () => {
  jest.mocked(assertBookingManagementAccess).mockResolvedValueOnce('DIRECT_BOOKINGS')
    .mockRejectedValueOnce(new HttpError(403, 'Outside your product scope'));
  await expect(resolveBookingAmendmentProduct(req, booking, 20)).rejects.toMatchObject({ status: 403 });
});
it.each([null, '', 0, -1, 1.5, '20x', '2e1', true, {}, Number.MAX_SAFE_INTEGER + 1])('rejects invalid product %p', async value => {
  await expect(resolveBookingAmendmentProduct(req, booking, value)).rejects.toMatchObject({ status: 400 });
  expect(Product.findByPk).not.toHaveBeenCalled();
});
it('allows retaining the current product or omitting it without changing legacy date amendments', async () => {
  expect(await resolveBookingAmendmentProduct(req, booking, undefined)).toBeNull();
  expect(await resolveBookingAmendmentProduct(req, booking, 10)).toBeNull();
  expect(Product.findByPk).not.toHaveBeenCalled();
});
it('rejects missing and inactive destination products', async () => {
  jest.mocked(Product.findByPk).mockResolvedValueOnce(null);
  await expect(resolveBookingAmendmentProduct(req, booking, 20)).rejects.toMatchObject({ status: 404 });
  jest.mocked(Product.findByPk).mockResolvedValueOnce({ id: 20, status: false } as Product);
  await expect(resolveBookingAmendmentProduct(req, booking, 20)).rejects.toMatchObject({ status: 400 });
});
