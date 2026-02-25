export const BOOKING_PLATFORMS = [
  'fareharbor',
  'ecwid',
  'viator',
  'getyourguide',
  'freetour',
  'xperiencepoland',
  'airbnb',
  'manual',
  'unknown',
] as const;

export type KnownBookingPlatform = typeof BOOKING_PLATFORMS[number];
export type BookingPlatform = KnownBookingPlatform | (string & {});

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'amended',
  'rebooked',
  'cancelled',
  'completed',
  'no_show',
  'unknown',
] as const;

export type BookingStatus = typeof BOOKING_STATUSES[number];

export const BOOKING_ATTENDANCE_STATUSES = [
  'pending',
  'checked_in_partial',
  'checked_in_full',
  'no_show',
] as const;

export type BookingAttendanceStatus = typeof BOOKING_ATTENDANCE_STATUSES[number];

export const BOOKING_PAYMENT_STATUSES = [
  'unknown',
  'unpaid',
  'deposit',
  'partial',
  'paid',
  'refunded',
] as const;

export type BookingPaymentStatus = typeof BOOKING_PAYMENT_STATUSES[number];

export const BOOKING_EVENT_TYPES = [
  'created',
  'amended',
  'cancelled',
  'replayed',
  'note',
] as const;

export type BookingEventType = typeof BOOKING_EVENT_TYPES[number];

export const GMAIL_CHANNEL_LABEL = 'Bookings';

export type NormalizedAddonInput = {
  platformAddonId?: string | null;
  platformAddonName?: string | null;
  addonId?: number | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  currency?: string | null;
  taxAmount?: number | null;
  included?: boolean;
  metadata?: Record<string, unknown>;
};
