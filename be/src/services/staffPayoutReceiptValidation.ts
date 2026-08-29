import type { StaffPayoutReceiptSourceItem } from './staffPayoutReceiptService.js';

export type PayoutReceiptPhotoFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const parseStaffPayoutAcknowledgedAmountMinor = (value: unknown): number => {
  const amount = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error('Acknowledged amount is required.');
  }
  return Math.round(amount * 100);
};

export const assertStaffPayoutAcknowledgedAmount = (value: unknown, expectedAmountMinor: number): void => {
  if (parseStaffPayoutAcknowledgedAmountMinor(value) !== expectedAmountMinor) {
    throw new Error('The acknowledged amount does not match this payout.');
  }
};

export const assertStaffPayoutReceiptActor = (params: {
  staffUserId: number;
  requiredActionId: number | null;
  actorId: number;
  actionId: number;
}): void => {
  if (params.staffUserId !== params.actorId || params.requiredActionId !== params.actionId) {
    throw new Error('Payout receipt request was not found.');
  }
};

export const decodeStaffPayoutSignatureDataUrl = (value: unknown): Buffer => {
  const signature =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    throw new Error('E-signature is required.');
  }
  const dataUrl = typeof (signature as { dataUrl?: unknown }).dataUrl === 'string'
    ? (signature as { dataUrl: string }).dataUrl.trim()
    : '';
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('E-signature must be a PNG image.');
  }
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
    throw new Error('E-signature file is empty or too large.');
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('E-signature image is invalid.');
  }
  return buffer;
};

export const validateStaffPayoutReceiptPhoto = <T extends PayoutReceiptPhotoFile | undefined>(file: T): Exclude<T, undefined> => {
  if (!file?.buffer?.length) {
    throw new Error('Photo evidence is required.');
  }
  const mimeType = file.mimetype.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType)) {
    throw new Error('Photo evidence must be a JPEG, PNG, WebP, HEIC, or HEIF image.');
  }
  if (file.size > 10 * 1024 * 1024 || file.buffer.length > 10 * 1024 * 1024) {
    throw new Error('Photo evidence cannot exceed 10 MB.');
  }
  const isJpeg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  const isPng = file.buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const isWebp = file.buffer.subarray(0, 4).toString('ascii') === 'RIFF' && file.buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const heifBrand = file.buffer.subarray(8, 12).toString('ascii').toLowerCase();
  const isHeif =
    file.buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(heifBrand);
  if (
    (mimeType === 'image/jpeg' && !isJpeg) ||
    (mimeType === 'image/png' && !isPng) ||
    (mimeType === 'image/webp' && !isWebp) ||
    ((mimeType === 'image/heic' || mimeType === 'image/heif') && !isHeif)
  ) {
    throw new Error('Photo evidence contents do not match the selected image type.');
  }
  return file as Exclude<T, undefined>;
};

export const groupStaffPayoutReceiptItemsByCurrency = (
  items: StaffPayoutReceiptSourceItem[],
): Array<{ currency: string; items: StaffPayoutReceiptSourceItem[]; amountMinor: number }> => {
  const grouped = new Map<string, StaffPayoutReceiptSourceItem[]>();
  items.forEach((item) => {
    const currency = item.currencyCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Payout receipt currency must be a three-letter code.');
    }
    const currencyItems = grouped.get(currency) ?? [];
    currencyItems.push({ ...item, currencyCode: currency });
    grouped.set(currency, currencyItems);
  });
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, currencyItems]) => ({
      currency,
      items: currencyItems,
      amountMinor: currencyItems.reduce((sum, item) => sum + item.amountMinor, 0),
    }));
};
