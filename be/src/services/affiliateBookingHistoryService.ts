import { QueryTypes, type Transaction as SequelizeTransaction } from 'sequelize';
import Booking from '../models/Booking.js';

// Both sides use the full contact value. In particular, phone matching never
// guesses a country code or compares only the last digits of a number.
const normalizedContacts = (alias: string): string => `
  lower(btrim(coalesce(${alias}.guest_email, ''))) AS email,
  regexp_replace(
    regexp_replace(coalesce(${alias}.guest_phone, ''), '[^0-9]', '', 'g'),
    '^00', ''
  ) AS phone`;

// Window aggregation considers every matching history row before selecting the
// requested IDs. It avoids a candidate-by-history join and its quadratic plans.
const priorPubCrawlQuery = `
WITH candidate_range AS (
  SELECT max(source_received_at) AS latest_received_at
  FROM bookings
  WHERE id = ANY($bookingIds::bigint[])
), history AS MATERIALIZED (
  SELECT booking.id, booking.source_received_at, booking.status, ${normalizedContacts('booking')}
  FROM bookings AS booking
  LEFT JOIN products AS product ON product.id = booking.product_id
  WHERE booking.source_received_at <= (SELECT latest_received_at FROM candidate_range)
    AND coalesce(nullif(btrim(product.name), ''), booking.product_name, '')
      ~* 'pub[[:space:]-]*crawl'
), contact_history AS (
  SELECT history.id, history.source_received_at,
    min(history.source_received_at)
      FILTER (WHERE coalesce(history.status, 'unknown') <> 'cancelled')
      OVER (PARTITION BY contact.kind, contact.value) AS first_received_at
  FROM history
  CROSS JOIN LATERAL (VALUES ('email', history.email), ('phone', history.phone))
    AS contact(kind, value)
  WHERE (contact.kind = 'email'
      AND contact.value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    OR (contact.kind = 'phone'
      AND contact.value ~ '^[0-9]{7,}$'
      AND contact.value !~ '^([0-9])\\1+$')
)
SELECT DISTINCT id
FROM contact_history
WHERE id = ANY($bookingIds::bigint[])
  AND first_received_at < source_received_at
`;

/**
 * Finds repeat pub-crawl customers independently of the report's dates and UTM
 * attribution. Only booking IDs leave this service; customer contacts stay in
 * the database. A booking at the same timestamp cannot disqualify itself.
 */
export const fetchAffiliateBookingsWithPriorPubCrawl = async (
  bookingIds: number[],
  transaction?: SequelizeTransaction,
): Promise<Set<number>> => {
  // PostgreSQL BIGINT IDs can arrive as strings despite the model's number type.
  const candidateIds = Array.from(new Set(bookingIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (candidateIds.length === 0) {
    return new Set();
  }
  const sequelize = Booking.sequelize;
  if (!sequelize) {
    throw new Error('Booking database connection is not initialized');
  }

  const rows = await sequelize.query<{ id: number | string }>(priorPubCrawlQuery, {
    bind: { bookingIds: candidateIds },
    type: QueryTypes.SELECT,
    transaction,
  });
  return new Set(rows.map((row) => Number(row.id)));
};
