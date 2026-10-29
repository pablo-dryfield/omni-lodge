import type { Transaction } from 'sequelize';
import Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import UserType from '../models/UserType.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { hasModuleActionPermission } from '../middleware/authorizationMiddleware.js';
import { getAllowedProductTypeIds } from './productScopeService.js';

// Email-managed channels (including Ecwid) have a separate, explicitly local
// correction path. Direct/storefront bookings retain their native workflows.
export const isLocalActionPlatform = (platform: unknown): boolean => {
  const value = String(platform ?? '').trim().toLowerCase();
  return Boolean(value) && !['direct', 'omnilodge', 'manual', 'unknown'].includes(value);
};

export const assertLocalBookingActionAccess = async (
  req: AuthenticatedRequest, booking: Booking, transaction?: Transaction,
): Promise<'DIRECT_BOOKINGS' | 'STOREFRONT'> => {
  if (!req.authContext?.userTypeId || !await hasModuleActionPermission(req, 'booking-management', 'update')) {
    throw new HttpError(403, 'Booking management update permission is required.');
  }
  const role = await UserType.findByPk(req.authContext.userTypeId, { attributes: ['slug', 'status'], transaction });
  if (!role?.status) throw new HttpError(403, 'An active management role is required.');
  const scope = await getAllowedProductTypeIds(req, transaction);
  const product = booking.productId == null ? null : await Product.findByPk(booking.productId, {
    attributes: ['id', 'productTypeId'], transaction,
  });
  const productType = product?.productTypeId == null ? null : await ProductType.findByPk(product.productTypeId, {
    attributes: ['id', 'name'], transaction,
  });
  const foodTour = Boolean(productType && /^food tour(?:$|[ -])/i.test(productType.name.trim()));
  if (scope === null) {
    const slug = role.slug.toLowerCase().replace(/[\s_-]+/g, '');
    if (!['admin', 'administrator', 'owner', 'manager', 'mgr'].includes(slug)) {
      throw new HttpError(403, 'Only Owners, Administrators and Managers can force booking changes.');
    }
  } else if (!['food-tour-owner', 'food-tour-manager'].includes(role.slug) || scope.length !== 1
    || !foodTour || product?.productTypeId !== scope[0]) {
    throw new HttpError(403, 'This booking is outside your Food Tour management scope.');
  }
  if (!isLocalActionPlatform(booking.platform)) {
    throw new HttpError(400, 'Use the existing payment-aware actions for this booking channel.');
  }
  return foodTour ? 'DIRECT_BOOKINGS' : 'STOREFRONT';
};
