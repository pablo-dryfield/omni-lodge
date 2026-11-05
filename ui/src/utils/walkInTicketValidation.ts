import { WALK_IN_TICKET_LABEL_TO_KEY } from '../constants/walkInTicketTypes';

type TicketIdentity = { name: string; ticketType?: string; currencyOrder: string[] };
type ChannelTickets = { ticketOrder: string[]; tickets: Record<string, TicketIdentity> };

export const normalizeWalkInTicketName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function getWalkInTicketType(key: string, ticket: Pick<TicketIdentity, 'ticketType'>): string {
  const legacyType = Object.prototype.hasOwnProperty.call(WALK_IN_TICKET_LABEL_TO_KEY, key) ? WALK_IN_TICKET_LABEL_TO_KEY[key] : undefined;
  return (ticket.ticketType ?? legacyType ?? 'custom').trim().toLowerCase() || 'custom';
}

export function hasWalkInTicketType(channel: ChannelTickets, ticketType: string, currency: string): boolean {
  return channel.ticketOrder.some(key => {
    const ticket = channel.tickets[key];
    return ticket && getWalkInTicketType(key, ticket) === ticketType && ticket.currencyOrder.includes(currency);
  });
}

/** A custom name must also be distinct from standard ticket names in this channel. */
export function getWalkInTicketIdentityErrors(channel: ChannelTickets): Record<string, string> {
  const errors: Record<string, string> = {};
  const typeCurrencies = new Map<string, string>();
  const names = new Map<string, Array<{ key: string; custom: boolean }>>();
  for (const key of channel.ticketOrder) {
    const ticket = channel.tickets[key];
    if (!ticket) continue;
    const type = getWalkInTicketType(key, ticket);
    const custom = type === 'custom';
    const name = normalizeWalkInTicketName(ticket.name);
    if (custom && !name) errors[key] = 'Enter a name for this custom ticket.';
    if (custom && ticket.name.length > 80) errors[key] = 'Use at most 80 characters for the ticket name.';
    if (name) names.set(name, [...(names.get(name) ?? []), { key, custom }]);
    if (custom) continue;
    for (const code of new Set(ticket.currencyOrder)) {
      const identity = `${type}:${code}`;
      const previous = typeCurrencies.get(identity);
      if (previous) {
        const message = `${ticket.name} (${code}) is already added. Keep one entry and update its quantity.`;
        errors[previous] = message;
        errors[key] = message;
      } else typeCurrencies.set(identity, key);
    }
  }
  for (const entries of names.values()) {
    if (entries.length < 2) continue;
    for (const { key, custom } of entries) {
      if (custom) errors[key] = 'Use a unique ticket name in this channel.';
    }
  }
  return errors;
}

export function nextCustomTicketName(channel: ChannelTickets): string {
  const names = new Set(channel.ticketOrder.flatMap(key => channel.tickets[key] ? [normalizeWalkInTicketName(channel.tickets[key].name)] : []));
  let name = 'Custom';
  let suffix = 2;
  while (names.has(normalizeWalkInTicketName(name))) name = `Custom ${suffix++}`;
  return name;
}
