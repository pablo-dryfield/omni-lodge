export const WALK_IN_TICKET_TYPE_VALUES = [
  'normal',
  'second_timers',
  'third_timers',
  'half_price',
  'students',
  'group',
] as const;

export type WalkInTicketType = (typeof WALK_IN_TICKET_TYPE_VALUES)[number];

export const WALK_IN_TICKET_TYPE_LABELS: Record<WalkInTicketType, string> = {
  normal: 'Normal',
  second_timers: 'Second Timers',
  third_timers: 'Third Timers',
  half_price: 'Half Price',
  students: 'Students',
  group: 'Group',
};

const WALK_IN_TICKET_TYPE_SET = new Set<string>(WALK_IN_TICKET_TYPE_VALUES);

export const normalizeWalkInTicketType = (
  value: string | null | undefined,
): WalkInTicketType => {
  const normalized = (value ?? 'normal').trim().toLowerCase();
  return WALK_IN_TICKET_TYPE_SET.has(normalized)
    ? (normalized as WalkInTicketType)
    : 'normal';
};

export const normalizeCurrencyCode = (value: string | null | undefined): string =>
  (value ?? 'PLN').trim().toUpperCase().slice(0, 3) || 'PLN';
