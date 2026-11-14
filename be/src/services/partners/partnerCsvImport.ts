import { parse } from 'csv-parse/sync';
import HttpError from '../../errors/HttpError.js';
import type { PartnerSelection } from './partnerBookingService.js';

export function parsePartnerCsv(csv: unknown, maxBookings: number): PartnerSelection[] {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 1024 * 1024) throw new HttpError(400, 'Upload a CSV smaller than 1 MB.');
  let rows: Array<Record<string, string>>;
  try { rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, trim: true, max_record_size: 16384 }); }
  catch { throw new HttpError(400, 'The CSV is not valid. Use the provided column template.'); }
  if (rows.length > maxBookings * 20) throw new HttpError(400, 'The import contains too many experience lines.');
  const bookings = new Map<string, PartnerSelection>();
  for (const row of rows) {
    const customer = { firstName: row.firstName, lastName: row.lastName, email: row.email, ...(row.phone ? { phone: row.phone } : {}) };
    if (!row.reference || !row.productId || !row.quantity || !row.experienceDate || !row.experienceTime) throw new HttpError(400, 'Every row requires reference, productId, quantity, experienceDate and experienceTime.');
    const paymentMode = (row.paymentMode || 'platform') as PartnerSelection['paymentMode'];
    const previous = bookings.get(row.reference);
    if (previous && (JSON.stringify(previous.customer) !== JSON.stringify(customer) || previous.paymentMode !== paymentMode || (previous.discountCode || '') !== (row.discountCode || '') || (previous.paymentReference || '') !== (row.paymentReference || ''))) throw new HttpError(400, `Rows sharing reference ${row.reference} must have the same customer and payment details.`);
    const booking: PartnerSelection = previous || { reference: row.reference, customer, paymentMode, paymentReference: row.paymentReference || undefined, discountCode: row.discountCode || undefined, items: [] };
    booking.items.push({ productId: Number(row.productId), quantity: Number(row.quantity), experienceDate: row.experienceDate, experienceTime: row.experienceTime, options: row.men || row.women ? { participants: { men: Number(row.men || 0), women: Number(row.women || 0) } } : {} });
    if (booking.items.length > 20) throw new HttpError(400, 'A booking can contain at most 20 experience lines.');
    bookings.set(row.reference, booking);
  }
  if (bookings.size > maxBookings) throw new HttpError(400, `Import at most ${maxBookings} bookings at a time.`);
  return [...bookings.values()];
}
