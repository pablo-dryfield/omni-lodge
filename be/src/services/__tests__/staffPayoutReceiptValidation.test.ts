import {
  assertStaffPayoutAcknowledgedAmount,
  assertStaffPayoutReceiptActor,
  decodeStaffPayoutSignatureDataUrl,
  groupStaffPayoutReceiptItemsByCurrency,
  validateStaffPayoutReceiptPhoto,
} from '../staffPayoutReceiptValidation.js';

const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('receipt-evidence'),
]);

describe('staff payout receipt validation', () => {
  it('groups a mixed-currency payout into deterministic currency subtotals', () => {
    const groups = groupStaffPayoutReceiptItemsByCurrency([
      { collectionLogId: 1, financeTransactionId: 10, label: 'Guiding', amountMinor: 40140, currencyCode: 'pln' },
      { collectionLogId: 2, financeTransactionId: 11, label: 'Commission', amountMinor: 5100, currencyCode: 'PLN' },
      { collectionLogId: 3, financeTransactionId: 12, label: 'Bonus', amountMinor: 2500, currencyCode: 'eur' },
    ]);

    expect(groups.map((group) => ({ currency: group.currency, amountMinor: group.amountMinor }))).toEqual([
      { currency: 'EUR', amountMinor: 2500 },
      { currency: 'PLN', amountMinor: 45240 },
    ]);
    expect(groups[1].items).toHaveLength(2);
  });

  it('rejects an actor or action that does not own the receipt request', () => {
    expect(() => assertStaffPayoutReceiptActor({
      staffUserId: 24,
      requiredActionId: 501,
      actorId: 25,
      actionId: 501,
    })).toThrow('Payout receipt request was not found.');
    expect(() => assertStaffPayoutReceiptActor({
      staffUserId: 24,
      requiredActionId: 501,
      actorId: 24,
      actionId: 502,
    })).toThrow('Payout receipt request was not found.');
  });

  it('requires the recipient to acknowledge the exact currency subtotal', () => {
    expect(() => assertStaffPayoutAcknowledgedAmount('532.40', 53240)).not.toThrow();
    expect(() => assertStaffPayoutAcknowledgedAmount('532.39', 53240)).toThrow(
      'The acknowledged amount does not match this payout.',
    );
  });

  it('accepts a PNG data URL signature and rejects invalid image contents', () => {
    const signature = JSON.stringify({
      dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
      signedAt: '2026-08-29T12:00:00.000Z',
    });
    expect(decodeStaffPayoutSignatureDataUrl(signature)).toEqual(pngBytes);

    const fakePng = `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}`;
    expect(() => decodeStaffPayoutSignatureDataUrl({ dataUrl: fakePng })).toThrow(
      'E-signature image is invalid.',
    );
  });

  it('requires a real supported image for photo evidence', () => {
    expect(() => validateStaffPayoutReceiptPhoto({
      buffer: Buffer.from('not-a-jpeg'),
      mimetype: 'image/jpeg',
      size: 10,
      originalname: 'evidence.jpg',
    })).toThrow('Photo evidence contents do not match the selected image type.');

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(validateStaffPayoutReceiptPhoto({
      buffer: jpeg,
      mimetype: 'image/jpeg',
      size: jpeg.length,
      originalname: 'evidence.jpg',
    }).buffer).toEqual(jpeg);
  });
});
