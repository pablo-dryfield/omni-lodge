export type WalkInSummaryRow = {
  key: string; channelId: number; channelName: string; ticket: string; guests: number;
  currency?: string; amount?: number; payment?: string; reason?: string;
  metricsGuests?: number;
  addons: Array<{ name: string; quantity: number; reason?: string }>;
  staff?: Array<{ name: string; label: string; reason?: string | null }>;
};
type CashEntry = { channelName?: string; currency: string; amount: number; qty: number; tickets?: Array<{
  staffGuests?: Array<{ userId: number; name: string }>; key?: string; name: string; transfer?: boolean; paymentMethodName?: string; paymentStatus?: string;
  currencies: Array<{ currency: string; people: number; cash: number; addons: Record<string, number> }>;
}> };
type FreeEntry = { channelName?: string; people?: { qty: number; note: string }; addons?: Record<string, { qty: number; note: string }> };
const qty = (value: number) => Math.max(0, Math.round(Number(value) || 0));

/** Each ticket/currency stays separate. Add-ons never increase the guest total. */
export function buildWalkInSummary(
  cash: Map<number, CashEntry>, free: Map<number, FreeEntry>,
  channels: Array<{ id: number; name: string }>, addons: Array<{ addonId: number; name: string }>,
): WalkInSummaryRow[] {
  const rows: WalkInSummaryRow[] = [];
  const channelName = (id: number, saved?: string) => channels.find(c => c.id === id)?.name || saved || `Channel ${id}`;
  const addonName = (id: string) => addons.find(a => a.addonId === Number(id))?.name || `Add-on ${id}`;
  cash.forEach((entry, channelId) => {
    if (entry.tickets?.length) {
      entry.tickets.forEach((ticket, index) => {
        // Online booking collections are already represented in the bookings list.
        if (ticket.key?.startsWith('booking-cash:')) return;
        ticket.currencies.forEach(currency => {
          const extras = Object.entries(currency.addons).filter(([, n]) => qty(n) > 0)
            .map(([id, n]) => ({ name: addonName(id), quantity: qty(n) }));
          if (qty(currency.people) === 0 && extras.length === 0) return;
          const amount = Number(currency.cash);
          rows.push({ key: `${channelId}:${ticket.key ?? index}:${currency.currency}`, channelId, channelName: channelName(channelId, entry.channelName),
            ticket: ticket.name, guests: qty(currency.people), currency: currency.currency,
            amount: Number.isFinite(amount) ? amount : undefined,
            payment: amount === 0 ? 'Free' : `${ticket.paymentMethodName || (ticket.transfer ? 'Transfer' : 'Cash')} · ${ticket.paymentStatus === 'awaiting' ? 'Awaiting payment' : 'Received'}`,
            addons: extras, staff: ticket.staffGuests?.map(person => ({ name: person.name, label: `Staff Ticket${currency.people > 0 ? ` - ${currency.currency} ${(amount / currency.people).toFixed(2)}` : ''}` })) });
        });
      });
    } else if (qty(entry.qty) > 0) {
      rows.push({ key: `${channelId}:legacy`, channelId, channelName: channelName(channelId, entry.channelName), ticket: 'Tickets', guests: qty(entry.qty), currency: entry.currency, amount: entry.amount, addons: [] });
    }
  });
  free.forEach((entry, channelId) => {
    const extras = Object.entries(entry.addons ?? {}).filter(([, a]) => qty(a.qty) > 0)
      .map(([id, a]) => ({ name: addonName(id), quantity: qty(a.qty), reason: a.note.trim() }));
    if (!qty(entry.people?.qty ?? 0) && !extras.length) return;
    rows.push({ key: `${channelId}:free`, channelId, channelName: channelName(channelId, entry.channelName), ticket: qty(entry.people?.qty ?? 0) ? 'Free guests' : 'Free add-ons',
      guests: qty(entry.people?.qty ?? 0), amount: 0, payment: 'Free', reason: entry.people?.note.trim(), addons: extras });
  });
  return rows.sort((a, b) => a.channelName.localeCompare(b.channelName) || a.ticket.localeCompare(b.ticket));
}

export function formatWalkInSummaryNotes(rows: WalkInSummaryRow[]): string {
  return rows.map(row => [
    `${row.channelName} — ${row.ticket}: ${row.guests} ${row.guests === 1 ? 'guest' : 'guests'}`,
    row.amount != null && row.currency ? `${row.currency} ${row.amount.toFixed(2)}` : '', row.payment,
    row.reason ? `Reason: ${row.reason}` : '',
    ...row.addons.map(addon => `${addon.name}: ${addon.quantity}${addon.reason ? ` (Reason: ${addon.reason})` : ''}`),
    ...(row.staff ?? []).map(person => `${person.name} — ${person.label}${person.reason ? ` (Reason: ${person.reason})` : ''}`),
  ].filter(Boolean).join(' | ')).join('\n');
}

export function staffRowsFromNotes(note: string, channels: Array<{ id: number; name: string }>): WalkInSummaryRow[] {
  const raw = note.match(/-- STAFF-ENTRIES START --([\s\S]*?)-- STAFF-ENTRIES END --/)?.[1];
  if (!raw) return [];
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    const staff = entries.filter(entry => entry && typeof entry.name === 'string' && typeof entry.label === 'string');
    if (!staff.length) return [];
    const channel = channels.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'walkin');
    return [{ key: 'staff-free', channelId: channel?.id ?? -1, channelName: channel?.name ?? 'Walk-In', ticket: 'Staff Free', guests: staff.length, amount: 0, addons: [], staff }];
  } catch { return []; }
}
