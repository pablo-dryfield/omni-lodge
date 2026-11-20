import type { UnifiedOrder } from '../store/bookingPlatformsTypes';

export const isLocalActionOrder = (order: Pick<UnifiedOrder, 'platform'>): boolean => {
  const platform = String(order.platform ?? '').trim().toLowerCase();
  return Boolean(platform) && !['direct', 'omnilodge', 'manual', 'unknown'].includes(platform);
};

export const isDirectCancellationOrder = (order: Pick<UnifiedOrder, 'platform'>): boolean =>
  String(order.platform ?? '').trim().toLowerCase() === 'direct';

export const canManageDirectCancellations = (
  roleSlug: string | null | undefined,
  productScoped: boolean,
  canUpdateBookings: boolean,
): boolean => {
  const role = String(roleSlug ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['assistant-manager', 'assistantmanager', 'assistmanager'].includes(role)) {
    // The backend rechecks the current role, update permission and booking product scope.
    return canUpdateBookings;
  }
  if (productScoped) {
    return canUpdateBookings && ['food-tour-owner', 'food-tour-manager'].includes(role);
  }
  return ['owner', 'admin', 'administrator', 'manager', 'mgr'].includes(role);
};
