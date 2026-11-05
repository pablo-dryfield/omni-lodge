import { WALK_IN_TICKET_TYPE_LABELS } from '../constants/walkInTicketTypes.js';

export type WalkInPaymentMetadata = { paymentMethodName?: string; paymentStatus?: string; transfer?: boolean };

/** Old snapshots did not store a method. Preserve their cash behavior except explicit transfers. */
export function isReceivedWalkInCash(ticket: WalkInPaymentMetadata): boolean {
  return ticket.paymentStatus !== 'awaiting' && (ticket.paymentMethodName ? ticket.paymentMethodName.trim().toLowerCase() === 'cash' : !ticket.transfer);
}

export function receivedCashByCurrency(entry: { currency: string; amount: number; tickets?: Array<WalkInPaymentMetadata & { currencies: Array<{ currency: string; cash: number }> }> }): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (currency: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const code = /^[A-Z]{3}$/.test(currency) ? currency : 'PLN';
    totals.set(code, Math.round(((totals.get(code) ?? 0) + amount) * 100) / 100);
  };
  if (entry.tickets?.length) {
    entry.tickets.filter(isReceivedWalkInCash).forEach((ticket) => ticket.currencies.forEach((row) => add(row.currency, row.cash)));
  } else add(entry.currency, entry.amount);
  return totals;
}

const START = '-- CASH-SNAPSHOT START --';
const END = '-- CASH-SNAPSHOT END --';
const legacyTicketTypes = new Map(Object.entries(WALK_IN_TICKET_TYPE_LABELS).map(([type, label]) => [label, type]));
const normalizedTicketName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

function validateTicketIdentities(tickets: Array<{ key?: string; name?: string; ticketType?: string; currencies?: Array<{ currency: string }> }>): void {
  const typeCurrencies = new Set<string>();
  const names = new Map<string, { count: number; custom: boolean }>();
  for (const ticket of tickets) {
    const type = (ticket.ticketType ?? legacyTicketTypes.get(ticket.key || ticket.name || '') ?? 'custom').trim().toLowerCase() || 'custom';
    const custom = type === 'custom';
    const displayName = typeof ticket.name === 'string' ? ticket.name : '';
    const name = normalizedTicketName(displayName);
    if (custom && (!name || displayName.length > 80)) throw new Error('Enter a name of 1 to 80 characters for each custom ticket.');
    if (name) {
      const previous = names.get(name);
      names.set(name, { count: (previous?.count ?? 0) + 1, custom: custom || Boolean(previous?.custom) });
    }
    if (custom || !Array.isArray(ticket.currencies)) continue;
    for (const row of ticket.currencies) {
      const identity = `${type}:${row.currency}`;
      if (typeCurrencies.has(identity)) throw new Error(`${ticket.name} (${row.currency}) is already added. Keep one entry per ticket type and currency in each channel.`);
      typeCurrencies.add(identity);
    }
  }
  if ([...names.values()].some(entry => entry.custom && entry.count > 1)) throw new Error('Use a unique ticket name for each custom ticket in this channel.');
}

/** Validate the new structured entries while preserving all older snapshot formats. */
export function normalizeWalkInPaymentNotes(notes: string | null, methods: Array<{ id: number; name: string }>): string | null {
  if (!notes || !notes.includes(START)) return notes;
  const start = notes.indexOf(START) + START.length;
  const end = notes.indexOf(END, start);
  if (end < 0) return notes;
  let snapshot: any;
  try { snapshot = JSON.parse(notes.slice(start, end)); } catch { return notes; }
  if (snapshot?.version !== 3) return notes;
  if (!snapshot.channels || typeof snapshot.channels !== 'object' || Array.isArray(snapshot.channels)) throw new Error('Invalid Walk-Ins channel data.');
  const methodMap = new Map(methods.map((method) => [method.id, method.name]));
  for (const channel of Object.values(snapshot.channels) as any[]) {
    if (!channel || !Array.isArray(channel.tickets)) continue;
    if (channel.tickets.length > 500) throw new Error('A channel cannot have more than 500 Walk-Ins entries.');
    const keys = new Set<string>();
    for (const ticket of channel.tickets) {
      if (!ticket || typeof ticket !== 'object') throw new Error('Invalid Walk-Ins ticket.');
      if (ticket.ticketType !== undefined && typeof ticket.ticketType !== 'string') throw new Error('Invalid Walk-Ins ticket type.');
      const isNew = ticket.ticketType === 'staff_paid' || (typeof ticket.key === 'string' && ticket.key.startsWith('entry:'));
      if (ticket.key) { if (keys.has(ticket.key)) throw new Error('Duplicate Walk-Ins entry.'); keys.add(ticket.key); }
      if (isNew && (typeof ticket.name !== 'string' || !ticket.name.trim() || ticket.name.length > 80)) throw new Error('Enter a name for each Walk-Ins ticket.');
      if (isNew || ticket.paymentMethodId !== undefined) {
        const method = methodMap.get(ticket.paymentMethodId);
        if (!method) throw new Error('Choose a valid payment method for each Walk-Ins entry.');
        ticket.paymentMethodName = method;
        ticket.transfer = /transfer/i.test(method);
        if (!['received', 'awaiting'].includes(ticket.paymentStatus)) throw new Error('Choose Received or Awaiting payment for each Walk-Ins entry.');
      }
      if (!isNew) continue;
      if (!Array.isArray(ticket.currencies) || ticket.currencies.length < 1 || ticket.currencies.length > 2) throw new Error('Choose a currency for each Walk-Ins entry.');
      const currencies = new Set<string>();
      for (const row of ticket.currencies) {
        if (!['PLN', 'EUR'].includes(row.currency) || currencies.has(row.currency)) throw new Error('Walk-Ins entries need distinct PLN or EUR amounts.');
        currencies.add(row.currency);
        if (!Number.isInteger(row.people) || row.people <= 0 || row.people > 10000) throw new Error('Each Walk-Ins entry needs between 1 and 10,000 guests.');
        if (typeof row.cash !== 'number' || !Number.isFinite(row.cash) || row.cash <= 0 || row.cash > 1e9) throw new Error('Enter a positive total for each Walk-Ins entry. Use Free entry for complimentary guests.');
        const validUnitPrice = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
        if (row.unitPrice !== undefined && !validUnitPrice(row.unitPrice)) throw new Error('Invalid Walk-Ins ticket unit price.');
        if (row.addonUnitPrices !== undefined && (!row.addonUnitPrices || typeof row.addonUnitPrices !== 'object' || Array.isArray(row.addonUnitPrices) || Object.entries(row.addonUnitPrices).some(([id, value]) => !/^[1-9]\d*$/.test(id) || !validUnitPrice(value)))) throw new Error('Invalid Walk-Ins add-on unit prices.');
        if (!row.addons || typeof row.addons !== 'object' || Array.isArray(row.addons) || Object.entries(row.addons).some(([id, qty]) => !/^[1-9]\d*$/.test(id) || !Number.isInteger(qty) || Number(qty) < 0 || Number(qty) > 10000)) throw new Error('Invalid Walk-Ins add-on quantities.');
      }
    }
    validateTicketIdentities(channel.tickets);
  }
  return `${notes.slice(0, start)}\n${JSON.stringify(snapshot)}\n${notes.slice(end)}`;
}
