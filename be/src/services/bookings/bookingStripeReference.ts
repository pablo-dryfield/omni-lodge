/** Stored references are shared by the read-only payment viewer and refund workflows. */
type ReferenceFields = { notes?: string | null; platformOrderId?: string | null; platformBookingId?: string | null; rawPayloadLocation?: string | null; platform?: string | null };

export const isStorefrontBooking = (booking: ReferenceFields): boolean =>
  String(booking.platform ?? '').trim().toLowerCase() === 'omnilodge' && Boolean(String(booking.platformOrderId ?? '').trim());

export function extractDirectStripeTransactionId(booking: ReferenceFields): string | null {
  for (const value of [booking.notes, booking.platformOrderId, booking.platformBookingId, booking.rawPayloadLocation]) {
    const match = String(value ?? '').match(/\b(?:pi|ch)_[A-Za-z0-9]+\b/);
    if (match) return match[0];
  }
  return null;
}

export function extractDirectStripeMode(booking: ReferenceFields): 'live' | 'test' | null {
  for (const value of [booking.notes, booking.rawPayloadLocation]) {
    const text = String(value ?? '');
    const live = text.match(/\bstripe\s+livemode\s*:\s*(true|false|1|0|yes|no)\b/i)?.[1];
    if (live) return ['true', '1', 'yes'].includes(live.toLowerCase()) ? 'live' : 'test';
    const mode = text.match(/\bstripe\s+mode\s*:\s*(live|test)\b/i)?.[1];
    if (mode) return mode.toLowerCase() as 'live' | 'test';
  }
  return null;
}
