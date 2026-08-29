import {
  buildStaffPayoutReceiptCompactView,
  buildStaffPayoutReceiptTotals,
} from '../staffPayoutReceiptViewService.js';

describe('staff payout receipt manager view', () => {
  it('exposes compact status without file storage identifiers', () => {
    expect(
      buildStaffPayoutReceiptCompactView({
        id: 42,
        status: 'completed',
        payoutBatchKey: 'batch-42:PLN',
        confirmedAt: new Date('2026-08-29T14:00:00.000Z'),
        cancelledAt: null,
        photoFileId: 10,
        signatureFileId: 11,
      }),
    ).toEqual({
      id: 42,
      status: 'completed',
      payoutBatchKey: 'batch-42:PLN',
      confirmedAt: '2026-08-29T14:00:00.000Z',
      cancelledAt: null,
      hasPhoto: true,
      hasSignature: true,
    });
  });

  it('groups receipt totals by normalized currency', () => {
    expect(
      buildStaffPayoutReceiptTotals([
        { amountMinor: 40140, currencyCode: 'pln' },
        { amountMinor: 5100, currencyCode: ' PLN ' },
        { amountMinor: 2500, currencyCode: 'eur' },
      ]),
    ).toEqual([
      { amountMinor: 2500, amount: 25, currency: 'EUR' },
      { amountMinor: 45240, amount: 452.4, currency: 'PLN' },
    ]);
  });
});
