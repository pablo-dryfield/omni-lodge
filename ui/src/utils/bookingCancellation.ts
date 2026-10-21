import type { UnifiedOrder } from '../store/bookingPlatformsTypes';

export const isDirectCancellationOrder = (order: Pick<UnifiedOrder, 'platform'>): boolean =>
  String(order.platform ?? '').trim().toLowerCase() === 'direct';

export const canManageDirectCancellations = (
  roleSlug: string | null | undefined,
  productScoped: boolean,
  canUpdateBookings: boolean,
): boolean => {
  const role = String(roleSlug ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (productScoped) {
    return canUpdateBookings && ['food-tour-owner', 'food-tour-manager'].includes(role);
  }
  return ['owner', 'admin', 'administrator', 'manager', 'mgr'].includes(role);
};
