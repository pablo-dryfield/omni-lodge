import type Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import UserType from '../models/UserType.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { hasModuleActionPermission } from '../middleware/authorizationMiddleware.js';
import { getAllowedProductTypeIds } from './productScopeService.js';

/** Cancellation follows the Direct channel, never words in the product title. */
export const isDirectBooking = (booking: Pick<Booking, 'platform'>): boolean =>
  String(booking.platform ?? '').trim().toLowerCase() === 'direct';

export async function assertDirectBookingCancellationAccess(
  req: AuthenticatedRequest,
  booking: Booking,
): Promise<void> {
  const scope = await getAllowedProductTypeIds(req);
  if (scope === null) {
    // Keep existing storefront cancellation behavior. Only Direct gains the new role policy.
    if (!isDirectBooking(booking)) return;
    const role = String(req.authContext?.roleSlug ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (['owner', 'admin', 'administrator', 'manager', 'mgr'].includes(role)) return;
  } else if (isDirectBooking(booking) && scope.length === 1 && req.authContext?.userTypeId) {
    // Read the current role record, not a display name or a stale role slug in the session.
    const role = await UserType.findByPk(req.authContext.userTypeId, { attributes: ['id', 'slug', 'status'] });
    if (role?.status && ['food-tour-owner', 'food-tour-manager'].includes(role.slug)
      && await hasModuleActionPermission(req, 'booking-management', 'update')) {
      const productType = await ProductType.findByPk(scope[0], { attributes: ['id', 'name'] });
      const product = booking.productId == null ? null
        : await Product.findByPk(booking.productId, { attributes: ['id', 'productTypeId'] });
      if (productType && /^food tour(?:$|[ -])/i.test(productType.name.trim())
        && product?.productTypeId === scope[0]) return;
    }
  }
  throw new HttpError(403, 'Only Owners, Administrators and Managers can cancel Direct bookings. Food Tour Owners and Managers are limited to their assigned Food Tour products.');
}
