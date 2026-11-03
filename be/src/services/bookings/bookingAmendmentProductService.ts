import type { Transaction } from 'sequelize';
import type Booking from '../../models/Booking.js';
import Product from '../../models/Product.js';
import HttpError from '../../errors/HttpError.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import { assertBookingManagementAccess } from '../localBookingActionPolicy.js';

/** Resolve the canonical destination and recheck both sides of a product move. */
export const resolveBookingAmendmentProduct = async (
  req: AuthenticatedRequest, booking: Booking, rawProductId: unknown, transaction?: Transaction,
): Promise<Product | null> => {
  if (rawProductId === undefined) return null;
  if (!['number', 'string'].includes(typeof rawProductId) || !/^[1-9]\d*$/.test(String(rawProductId))
    || !Number.isSafeInteger(Number(rawProductId))) {
    throw new HttpError(400, 'Select a valid booking product.');
  }
  const id = Number(rawProductId);
  if (id === booking.productId) return null;
  await assertBookingManagementAccess(req, booking, transaction);
  const product = await Product.findByPk(id, { transaction });
  if (!product) throw new HttpError(404, 'The selected product was not found.');
  await assertBookingManagementAccess(req, { productId: product.id } as Booking, transaction);
  if (!product.status) throw new HttpError(400, 'The selected product is inactive.');
  return product;
};

export const amendmentProductSnapshot = (booking: Booking) => ({
  productId: booking.productId, productName: booking.productName,
});
