import { getWalkInTicketIdentityErrors } from './walkInTicketValidation';

export function readWalkInPaymentMetadata(value: unknown) {
  const row = value as Record<string, unknown>;
  return {
    staffGuests: Array.isArray(row.staffGuests) ? row.staffGuests.filter(item => item && Number.isSafeInteger(item.userId) && item.userId > 0 && typeof item.name === 'string').map(item => ({ userId: Number(item.userId), name: String(item.name) })) : undefined,
    ticketType: typeof row.ticketType === 'string' ? row.ticketType.slice(0, 64) : undefined,
    paymentMethodId: Number.isInteger(row.paymentMethodId) && Number(row.paymentMethodId) > 0 ? Number(row.paymentMethodId) : undefined,
    paymentMethodName: typeof row.paymentMethodName === 'string' ? row.paymentMethodName.slice(0, 100) : undefined,
    paymentStatus: row.paymentStatus === 'awaiting' ? 'awaiting' as const : row.paymentStatus === 'received' ? 'received' as const : undefined,
  };
}

export function readWalkInPriceMetadata(value: unknown) {
  const row = value as Record<string, unknown>;
  const unitPrice = typeof row.unitPrice === 'number' && Number.isFinite(row.unitPrice) && row.unitPrice >= 0 ? row.unitPrice : undefined;
  const addonUnitPrices: Record<number, number> = {};
  if (row.addonUnitPrices && typeof row.addonUnitPrices === 'object') Object.entries(row.addonUnitPrices).forEach(([id, amount]) => {
    if (/^[1-9]\d*$/.test(id) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) addonUnitPrices[Number(id)] = amount;
  });
  return { unitPrice, addonUnitPrices };
}

export function isReceivedWalkInCash(ticket: { paymentMethodName?: string; paymentStatus?: string; transfer?: boolean }) {
  return ticket.paymentStatus !== 'awaiting' && (ticket.paymentMethodName ? ticket.paymentMethodName.trim().toLowerCase() === 'cash' : !ticket.transfer);
}

export function getWalkInValidationError(value: Record<number, { ticketOrder: string[]; tickets: Record<string, { name: string; ticketType?: string; paymentMethodId?: number; currencyOrder: string[]; currencies: Partial<Record<string, { people: number; cash: string }>> }> }>): string | null {
  for (const channel of Object.values(value)) {
    const identityError = Object.values(getWalkInTicketIdentityErrors(channel))[0];
    if (identityError) return identityError;
    for (const key of channel.ticketOrder) {
      const ticket = channel.tickets[key];
      // Historical entries do not require the newer payment and price metadata.
      if (!key.startsWith('entry:') || !ticket) continue;
      if (!ticket.name.trim()) return 'Enter a name for each custom ticket.';
      if (!ticket.paymentMethodId) return 'Choose a payment method for each Walk-Ins entry.';
      for (const code of ticket.currencyOrder) {
        const row = ticket.currencies[code];
        if (!row || !Number.isInteger(row.people) || row.people <= 0) return 'Each Walk-Ins entry needs at least one guest. Remove empty entries.';
        if (!row.cash.trim() || !Number.isFinite(Number(row.cash)) || Number(row.cash) <= 0) return 'Enter a positive amount for each paid entry. Use Free entry for complimentary guests.';
      }
    }
  }
  return null;
}
