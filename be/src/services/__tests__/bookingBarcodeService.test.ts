import { createBookingBarcodes } from '../bookingBarcodeService';

describe('booking barcodes', () => {
  it('only emits one image per valid persisted booking ID', async () => {
    const result = await createBookingBarcodes([41001, 41001, 0, -1, NaN, Infinity, 1.5]);
    expect([...result.imageSources.keys()]).toEqual([41001]);
    expect(result.attachments).toHaveLength(1);
    expect(result.imageSources.get(41001)).toBe(`cid:${result.attachments[0].contentId}`);
    expect(result.attachments[0].content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('uses the same PNG bytes in browser previews as in customer emails', async () => {
    const email = await createBookingBarcodes([41001]);
    const preview = await createBookingBarcodes([41001], 'preview');
    expect(preview.attachments).toEqual([]);
    expect(preview.imageSources.get(41001)).toBe(
      `data:image/png;base64,${email.attachments[0].content.toString('base64')}`,
    );
  });
});
