import bwipjs from 'bwip-js/node';

export type BookingBarcodeImageMode = 'cid' | 'preview';

/** Encode the internal booking ID already accepted by manifest search. */
export const createBookingBarcodes = async (
  bookingIds: Iterable<number>,
  imageMode: BookingBarcodeImageMode = 'cid',
) => {
  const imageSources = new Map<number, string>();
  const attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
    contentId: string;
  }> = [];

  // Only persisted booking IDs qualify. An order reference is not a booking ID.
  for (const bookingId of new Set(bookingIds)) {
    if (!Number.isSafeInteger(bookingId) || bookingId <= 0) continue;
    const content = await bwipjs.toBuffer({
      bcid: 'code128',
      text: String(bookingId),
      scale: 3,
      height: 14,
      includetext: false,
      backgroundcolor: 'FFFFFF',
      // Code 128 needs a quiet zone of at least ten modules on each side.
      paddingwidth: 10,
      paddingheight: 2,
    });
    const contentId = `booking-${bookingId}@omnilodge`;
    imageSources.set(bookingId, imageMode === 'preview'
      ? `data:image/png;base64,${content.toString('base64')}`
      : `cid:${contentId}`);
    if (imageMode === 'cid') {
      attachments.push({ filename: `booking-${bookingId}.png`, content, contentType: 'image/png', contentId });
    }
  }
  return { imageSources, attachments };
};
