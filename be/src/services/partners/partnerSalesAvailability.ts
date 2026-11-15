import dayjs from 'dayjs';
import { evaluateStorefrontAvailability, STOREFRONT_AVAILABILITY_TIMEZONE } from '../storefrontAvailabilityService.js';
import type { StorefrontProductConfig } from '../../types/storefront.js';
import HttpError from '../../errors/HttpError.js';

/** Calendar presentation uses the same date overrides/cutoffs as checkout.
 * Redirects may only identify another product approved for this partner. */
export function partnerCalendar(config: StorefrontProductConfig, month: unknown, time: unknown, approvedIds: number[], now = new Date()) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Choose a valid calendar month.');
  if (time !== undefined && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new HttpError(400, 'Choose a valid start time.');
  const first = dayjs(`${month}-01`);
  if (!first.isValid() || first.format('YYYY-MM') !== month) throw new HttpError(400, 'Choose a valid calendar month.');
  const today = dayjs(now).tz(STOREFRONT_AVAILABILITY_TIMEZONE).format('YYYY-MM-DD');
  const days = Array.from({ length: first.daysInMonth() }, (_, index) => {
    const date = first.date(index + 1).format('YYYY-MM-DD');
    const result = evaluateStorefrontAvailability(config, { experienceDate: date, experienceTime: typeof time === 'string' ? time : config.defaultStartTime, now });
    return { date, available: date >= today && result.available, message: date < today ? 'This date has passed.' : result.message,
      redirectProductId: result.redirectProductId && approvedIds.includes(result.redirectProductId) ? result.redirectProductId : null };
  });
  return { today, timeZone: STOREFRONT_AVAILABILITY_TIMEZONE, days };
}
