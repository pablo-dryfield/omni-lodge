import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const CUTOFF_MINUTES = 20 * 60 + 45;
export const AFFILIATE_COMMISSION_TIMEZONE = 'Europe/Warsaw';
const cutoff = `${Math.floor(CUTOFF_MINUTES / 60)}:${String(CUTOFF_MINUTES % 60).padStart(2, '0')}`;

export const AFFILIATE_COMMISSION_RULES = [
  'The booking must match an affiliate UTM assignment. Explicitly unpaid bookings earn no commission; legacy unknown payment statuses retain their existing treatment.',
  'Bookings with an applied discount earn no commission. The discount code remains visible in the booking status.',
  'Repeat Pub Crawl bookings with a previous non-cancelled booking matching the same email or phone earn no commission.',
  `Same-day bookings received at or after ${cutoff} (${AFFILIATE_COMMISSION_TIMEZONE}) earn no commission. Advance bookings are not excluded by this cutoff.`,
  'Commission is the number of guests multiplied by the assigned affiliate\'s current per-person rate.',
  'Already-recorded commission payouts retain their historical amounts; these rules do not silently reverse paid commission.',
];

export const getAffiliateCommissionEligibility = (
  sourceReceivedAt: string | null,
  experienceDate: string | null,
  isCommissionPaid = false,
  hasPriorPubCrawlBooking = false,
  discountAmount = 0,
  discountCode: string | null = null,
): { eligible: boolean; reason: string | null } => {
  // A recorded payout is an accounting fact, not a recalculated unpaid earning.
  if (isCommissionPaid) return { eligible: true, reason: null };
  if (Number(discountAmount) > 0) {
    const code = typeof discountCode === 'string' ? discountCode.trim() : '';
    return { eligible: false, reason: code ? `Discount applied: ${code}` : 'Discount applied' };
  }
  if (hasPriorPubCrawlBooking) return { eligible: false, reason: 'Previous Pub Crawl booking (matching email or phone)' };
  if (!sourceReceivedAt || !experienceDate) return { eligible: true, reason: null };
  const received = dayjs(sourceReceivedAt).tz(AFFILIATE_COMMISSION_TIMEZONE);
  if (received.isValid() && received.format('YYYY-MM-DD') === experienceDate
    && received.hour() * 60 + received.minute() >= CUTOFF_MINUTES) {
    return { eligible: false, reason: `Same-day booking at or after ${cutoff}` };
  }
  return { eligible: true, reason: null };
};
