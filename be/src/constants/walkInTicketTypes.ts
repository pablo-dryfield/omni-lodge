export const WALK_IN_TICKET_TYPE_VALUES = [
  'normal',
  'second_timers',
  'third_timers',
  'half_price',
  'students',
  'group',
] as const;

export type WalkInTicketType = string;

export const WALK_IN_TICKET_TYPE_LABELS: Record<WalkInTicketType, string> = {
  normal: 'Normal',
  second_timers: 'Second Timers',
  third_timers: 'Third Timers',
  half_price: 'Half Price',
  students: 'Students',
  group: 'Group',
};

export const normalizeWalkInTicketType = (
  value: string | null | undefined,
): WalkInTicketType => {
  const normalized = (value ?? 'normal').trim().toLowerCase();
  return normalized || 'normal';
};

export const normalizeCurrencyCode = (value: string | null | undefined): string =>
  (value ?? 'PLN').trim().toUpperCase().slice(0, 3) || 'PLN';
