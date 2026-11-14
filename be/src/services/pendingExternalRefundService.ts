import { Op, literal } from 'sequelize';
import Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import { normalizeBookingAddonRefundActions } from './bookingAddonRefundActions.js';
import { scopeProductWhere, type ProductTypeScope } from './productScopeService.js';

// Filter in PostgreSQL before pagination. The same normalizer is used by the
// Counter Summary mutation endpoints, including legacy records without status.
export const pendingExternalRefundPredicate = literal(`EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE
    WHEN jsonb_typeof("Bookings"."addon_refund_actions") = 'array'
    THEN "Bookings"."addon_refund_actions" ELSE '[]'::jsonb END) AS refund
  WHERE btrim(COALESCE(refund->>'id', '')) <> ''
    AND btrim(COALESCE(refund->>'addonKey', '')) IN ('cocktails', 'tshirts', 'photos')
    AND lower(btrim(COALESCE(refund->>'status', ''))) NOT IN ('completed', 'declined')
    AND CASE WHEN COALESCE(refund->>'quantity', '') ~ '^[0-9]+(\\.[0-9]+)?$'
      THEN (refund->>'quantity')::numeric >= 0.5 ELSE false END
)`);

export const listPendingExternalRefunds = async (scope: ProductTypeScope, limit: number, offset: number) => {
  const { rows, count } = await Booking.findAndCountAll({
    where: { [Op.and]: [pendingExternalRefundPredicate] },
    attributes: ['id', 'platform', 'platformBookingId', 'guestFirstName', 'guestLastName',
      'productName', 'experienceDate', 'addonRefundActions'],
    include: [{ model: Product, as: 'product', attributes: ['id', 'name'],
      ...(scope === null ? { required: false } : { required: true, where: scopeProductWhere(scope) }) }],
    order: [['experienceDate', 'ASC'], ['id', 'ASC']],
    limit, offset, distinct: true,
  });
  return {
    data: rows.map(booking => ({
      bookingId: Number(booking.id),
      customerName: [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ').trim() || 'Guest',
      platform: booking.platform,
      platformBookingId: booking.platformBookingId,
      productName: booking.product?.name ?? booking.productName,
      experienceDate: booking.experienceDate,
      actions: normalizeBookingAddonRefundActions(booking.addonRefundActions)
        .filter(action => action.status === 'pending')
        .map(action => ({ id: action.id, addonKey: action.addonKey, quantity: action.quantity,
          counterId: Number.isSafeInteger(Number(action.counterId)) && Number(action.counterId) > 0 ? Number(action.counterId) : null,
          reason: typeof action.reason === 'string' ? action.reason : null })),
    })),
    meta: { totalBookings: count, limit, offset },
  };
};
