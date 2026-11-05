import { Op, type Transaction } from 'sequelize';
import Booking from '../models/Booking.js';
import Channel from '../models/Channel.js';
import ChannelProductPrice from '../models/ChannelProductPrice.js';
import Counter from '../models/Counter.js';
import HttpError from '../errors/HttpError.js';
import { normalizeBookingExtrasSnapshot } from '../utils/bookingExtras.js';
import { qualifiesForStaffFreeThreshold } from './staffFreeEntryPolicy.js';

const amount = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);
const positiveCount = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function snapshot(notes: string | null, name: string): Record<string, unknown> {
  const start = `-- ${name}-SNAPSHOT START --`, end = `-- ${name}-SNAPSHOT END --`;
  if (!notes?.includes(start)) return {};
  const from = notes.indexOf(start) + start.length, to = notes.indexOf(end, from);
  if (to < 0) throw new HttpError(409, 'Save the counter to repair its incomplete walk-in record before admitting staff.');
  try { return object(JSON.parse(notes.slice(from, to))); }
  catch { throw new HttpError(409, 'Save the counter to repair its invalid walk-in record before admitting staff.'); }
}

export function bookingBaseTicketTotal(booking: Pick<Booking, 'priceGross' | 'baseAmount' | 'discountAmount' | 'addonsAmount' | 'addonsSnapshot' | 'tipAmount' | 'refundedAmount'>): number | null {
  // Gross is before the channel commission. Supplier net must not determine ticket eligibility.
  const gross = amount(booking.priceGross);
  if (gross === null) return null;
  let addons = amount(booking.addonsAmount);
  if (addons === null) {
    const rows = object(booking.addonsSnapshot).addons;
    if (Array.isArray(rows) && rows.length) {
      addons = 0;
      for (const value of rows) {
        const row = object(value), total = amount(row.totalPrice ?? row.total);
        const unit = amount(row.unitPrice);
        if (row.isIncluded === true) continue;
        if (total !== null) addons += total;
        else if (unit !== null) addons += unit * positiveCount(row.quantity);
        else return null;
      }
    } else {
      if (Object.values(normalizeBookingExtrasSnapshot(booking.addonsSnapshot)).some(qty => qty > 0)) return null;
      addons = 0;
    }
  }
  return Math.max(0, gross - (amount(booking.discountAmount) ?? 0) - addons - (amount(booking.tipAmount) ?? 0) - (amount(booking.refundedAmount) ?? 0));
}

export async function getStaffFreeQualification(counter: Counter, minimumPercent: number, transaction?: Transaction) {
  const channels = await Channel.findAll({ attributes: ['id', 'name'], transaction });
  const walkIn = channels.find(channel => channel.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'walkin');
  const prices = walkIn && counter.productId ? await ChannelProductPrice.findAll({ where: {
    channelId: walkIn.id, productId: counter.productId, ticketType: 'normal', validFrom: { [Op.lte]: counter.date },
    [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: counter.date } }],
  }, order: [['validFrom', 'DESC'], ['id', 'DESC']], transaction }) : [];
  const normalPrices: Record<string, number> = {};
  prices.forEach(row => { if (!(row.currencyCode in normalPrices)) normalPrices[row.currencyCode] = Number(row.price); });
  const result = { count: 0, totalCustomers: 0, free: 0, belowMinimum: 0, unpriced: 0, normalPrices, minimumPercent };
  const add = (attended: number, party: number, currency: string, base: number | null) => {
    if (attended <= 0) return;
    result.totalCustomers += attended;
    if (base === 0) { result.free += attended; return; }
    const qualifies = qualifiesForStaffFreeThreshold(base, party, normalPrices[currency] ?? null, minimumPercent);
    if (qualifies === null) result.unpriced += attended;
    else if (qualifies) result.count += attended;
    else result.belowMinimum += attended;
  };
  if (counter.productId) {
    const bookings = await Booking.findAll({ where: { productId: counter.productId, experienceDate: counter.date, attendedTotal: { [Op.gt]: 0 },
      status: { [Op.in]: ['pending', 'confirmed', 'amended', 'completed', 'rebooked', 'no_show'] },
    }, transaction });
    bookings.forEach(booking => {
      const party = positiveCount(booking.partySizeTotal ?? ((booking.partySizeAdults ?? 0) + (booking.partySizeChildren ?? 0)));
      const attended = Math.min(party, positiveCount(booking.attendedTotal));
      add(attended, party, booking.currency ?? '', bookingBaseTicketTotal(booking));
    });
  }
  const cash = snapshot(counter.notes, 'CASH');
  Object.values(object(cash.channels)).forEach(channelValue => {
    const channel = object(channelValue);
    if (!Array.isArray(channel.tickets)) { const qty = positiveCount(channel.qty); add(qty, qty, String(channel.currency ?? ''), null); return; }
    channel.tickets.forEach(ticketValue => {
      const ticket = object(ticketValue);
      // Collections for online reservations are already represented by Booking.attendedTotal.
      if (String(ticket.key ?? '').startsWith('booking-cash:')) return;
      if (!Array.isArray(ticket.currencies)) return;
      ticket.currencies.forEach(value => {
        const row = object(value), qty = positiveCount(row.people), total = amount(row.cash);
        let addonsTotal = 0, hasUnknownAddon = false;
        Object.entries(object(row.addons)).forEach(([id, quantity]) => {
          const count = positiveCount(quantity); if (!count) return;
          const unitPrice = amount(object(row.addonUnitPrices)[id]);
          if (unitPrice === null) hasUnknownAddon = true; else addonsTotal += count * unitPrice;
        });
        add(qty, qty, String(row.currency ?? ''), total === null || hasUnknownAddon ? null : Math.max(0, total - addonsTotal));
      });
    });
  });
  Object.values(object(snapshot(counter.notes, 'FREE').channels)).forEach(value => {
    const qty = positiveCount(object(object(value).people).qty); add(qty, qty, '', 0);
  });
  return result;
}
