import {
  canAmendLockedStorefrontSchedule,
  isBackofficeBankTransferOrder,
} from '../storefrontBookingAmendmentPolicy';

describe('storefront booking amendment terminal-state guard', () => {
  it('rejects a stale amendment when the locked booking was cancelled after the page loaded', () => {
    const stalePageBookingStatus = 'pending';
    const lockedBookingStatus = 'cancelled';

    expect(stalePageBookingStatus).toBe('pending');
    expect(canAmendLockedStorefrontSchedule('pending_payment', lockedBookingStatus)).toBe(false);
  });

  it('rejects an amendment when cancellation won through the locked order row', () => {
    expect(canAmendLockedStorefrontSchedule('cancelled', 'pending')).toBe(false);
  });

  it.each([
    ['pending_payment', 'pending'],
    ['confirmed', 'confirmed'],
    ['confirmed', 'amended'],
  ])('allows non-terminal order %s with booking %s', (orderStatus, bookingStatus) => {
    expect(canAmendLockedStorefrontSchedule(orderStatus, bookingStatus)).toBe(true);
  });

  it('identifies only backoffice bank-transfer orders for the extra permission gate', () => {
    expect(isBackofficeBankTransferOrder({ orderSource: 'backoffice', paymentMethod: 'bank_transfer' })).toBe(true);
    expect(isBackofficeBankTransferOrder({ orderSource: 'storefront', paymentMethod: 'bank_transfer' })).toBe(false);
    expect(isBackofficeBankTransferOrder({ orderSource: 'backoffice', paymentMethod: 'stripe' })).toBe(false);
  });
});
