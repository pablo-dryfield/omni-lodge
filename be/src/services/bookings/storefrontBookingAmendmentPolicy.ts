export const canAmendLockedStorefrontSchedule = (
  orderStatus: string | null | undefined,
  persistedBookingStatus: string | null | undefined,
): boolean => (
  String(orderStatus ?? '').trim().toLowerCase() !== 'cancelled'
  && String(persistedBookingStatus ?? '').trim().toLowerCase() !== 'cancelled'
);

export const isBackofficeBankTransferOrder = (order: {
  orderSource?: string | null;
  paymentMethod?: string | null;
}): boolean => (
  String(order.orderSource ?? '').trim().toLowerCase() === 'backoffice'
  && String(order.paymentMethod ?? '').trim().toLowerCase() === 'bank_transfer'
);
