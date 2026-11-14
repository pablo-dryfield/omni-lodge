/** Read only genuine Walk-In attendance. Reservation cash receipts are already in Booking. */
export function partnerCounterWalkIns(notes: string | null | undefined, channelId: number, cocktailAddonId: number | null) {
  const empty = { people: 0, addons: new Map<number, number>() };
  if (!notes) return empty;
  const start = notes.indexOf('-- CASH-SNAPSHOT START --');
  const end = notes.indexOf('-- CASH-SNAPSHOT END --', start);
  if (start < 0 || end < 0) return empty;
  try {
    const snapshot = JSON.parse(notes.slice(start + '-- CASH-SNAPSHOT START --'.length, end));
    const tickets = snapshot?.channels?.[String(channelId)]?.tickets;
    if (!Array.isArray(tickets)) return empty;
    let total = 0;
    for (const ticket of tickets) {
      if (String(ticket?.key || '').startsWith('booking-cash:') || !Array.isArray(ticket?.currencies)) continue;
      for (const row of ticket.currencies) {
        total += Math.max(0, Math.round(Number(row.people) || 0));
        for (const [id, quantity] of Object.entries(row.addons || {})) {
          const amount = Math.max(0, Math.round(Number(quantity) || 0));
          empty.addons.set(Number(id), (empty.addons.get(Number(id)) || 0) + amount);
        }
      }
    }
    empty.people = Math.max(0, total - (cocktailAddonId ? empty.addons.get(cocktailAddonId) || 0 : 0));
    return empty;
  } catch { return empty; }
}
