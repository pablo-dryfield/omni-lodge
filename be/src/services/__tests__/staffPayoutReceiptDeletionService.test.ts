import { buildStaffPayoutReceiptReissueItems } from '../staffPayoutReceiptDeletionService.js';

const item = (collectionLogId: number | null) => ({
  collectionLogId,
  financeTransactionId: collectionLogId == null ? null : collectionLogId + 100,
  label: collectionLogId == null ? 'Historic item' : `Payout ${collectionLogId}`,
  amountMinor: collectionLogId == null ? 500 : collectionLogId * 100,
  currencyCode: 'PLN',
});

describe('staff payout receipt deletion planning', () => {
  it('reissues only live items that were not selected for deletion', () => {
    expect(buildStaffPayoutReceiptReissueItems(
      [item(null), item(11), item(12), item(13)],
      [11, 13],
    )).toEqual([{
      collectionLogId: 12,
      financeTransactionId: 112,
      label: 'Payout 12',
      amountMinor: 1200,
      currencyCode: 'PLN',
    }]);
  });

  it('supports sequential partial deletions against each newly reissued item set', () => {
    const afterFirstDeletion = buildStaffPayoutReceiptReissueItems(
      [item(21), item(22), item(23)],
      [21],
    );
    const afterSecondDeletion = buildStaffPayoutReceiptReissueItems(
      afterFirstDeletion,
      [22],
    );

    expect(afterSecondDeletion.map((entry) => entry.collectionLogId)).toEqual([23]);
  });
});
