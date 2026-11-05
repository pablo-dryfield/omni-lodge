import { QueryTypes, Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import HttpError from '../errors/HttpError.js';

// SQL fragments are fixed; every user-supplied filter is passed as a replacement.
const ACTIVE = "c.status IN ('active', 'checkout_started', 'sending_recovery', 'recovery_sent')";
const ITEMS = "CASE WHEN jsonb_typeof(c.quote_snapshot->'items') = 'array' THEN c.quote_snapshot->'items' ELSE '[]'::jsonb END";
const SENT = '(c.recovery_count > 0 OR c.first_recovery_sent_at IS NOT NULL OR c.recovery_sent_at IS NOT NULL)';
const SORTS: Record<string, string> = {
  activity_desc: 'c.last_activity_at DESC', activity_asc: 'c.last_activity_at ASC',
  created_desc: 'c.created_at DESC', created_asc: 'c.created_at ASC',
  customer_asc: "LOWER(c.customer->>'fullName') ASC NULLS LAST", customer_desc: "LOWER(c.customer->>'fullName') DESC NULLS LAST",
  amount_desc: 'c.currency ASC, c.total DESC', amount_asc: 'c.currency ASC, c.total ASC',
  experience_asc: `(SELECT MIN(NULLIF(item->>'experienceDate', '')) FROM jsonb_array_elements(${ITEMS}) item) ASC NULLS LAST`,
  experience_desc: `(SELECT MIN(NULLIF(item->>'experienceDate', '')) FROM jsonb_array_elements(${ITEMS}) item) DESC NULLS LAST`,
  recovery_desc: 'c.recovery_count DESC', recovery_asc: 'c.recovery_count ASC',
};
const scalar = (query: Record<string, unknown>, key: string, maxLength = 200): string => {
  const value = query[key];
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) throw new HttpError(400, `Invalid ${key}.`);
  return value.trim();
};
const integer = (value: string, fallback: number, max: number, label: string) => {
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new HttpError(400, `Invalid ${label}.`);
  return Number(value);
};
const date = (query: Record<string, unknown>, key: string) => {
  const value = scalar(query, key, 10);
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new HttpError(400, `Invalid ${key}.`);
  return value;
};

export function ongoingCartListQuery(query: Record<string, unknown>) {
  const page = integer(scalar(query, 'page'), 1, 1000000, 'page');
  const pageSize = integer(scalar(query, 'pageSize'), 25, 100, 'page size');
  const sort = scalar(query, 'sort') || 'activity_desc';
  if (!Object.prototype.hasOwnProperty.call(SORTS, sort)) throw new HttpError(400, 'Invalid sort order.');
  const conditions = [ACTIVE];
  const replacements: Record<string, string | number> = {};
  const search = scalar(query, 'search');
  if (search) {
    replacements.search = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push("(c.customer->>'fullName' ILIKE :search OR c.customer->>'email' ILIKE :search OR c.customer->>'phone' ILIKE :search OR c.public_id::text ILIKE :search)");
  }
  const status = scalar(query, 'status');
  if (status) {
    if (!['active', 'checkout_started', 'sending_recovery', 'recovery_sent'].includes(status)) throw new HttpError(400, 'Invalid cart status.');
    conditions.push('c.status = :status'); replacements.status = status;
  }
  const recovery = scalar(query, 'recovery');
  const recoveries: Record<string, string> = {
    not_sent: `NOT ${SENT}`, sent: `${SENT} AND c.recovery_opened_at IS NULL`,
    opened: 'c.recovery_opened_at IS NOT NULL',
    due: `NOT ${SENT} AND c.recovery_due_at <= CURRENT_TIMESTAMP AND c.status <> 'sending_recovery'`,
  };
  if (recovery) {
    if (!Object.prototype.hasOwnProperty.call(recoveries, recovery)) throw new HttpError(400, 'Invalid recovery filter.');
    conditions.push(`(${recoveries[recovery]})`);
  }
  const country = scalar(query, 'country', 2).toUpperCase();
  if (country) {
    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Invalid country.');
    conditions.push("UPPER(c.customer->>'phoneCountry') = :country"); replacements.country = country;
  }
  const currency = scalar(query, 'currency', 3).toUpperCase();
  if (currency) {
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Invalid currency.');
    conditions.push('c.currency = :currency'); replacements.currency = currency;
  }
  const minAmount = scalar(query, 'minAmount'), maxAmount = scalar(query, 'maxAmount');
  for (const [key, value, operator] of [['minAmount', minAmount, '>='], ['maxAmount', maxAmount, '<=']]) {
    if (!value) continue;
    if (!currency) throw new HttpError(400, 'Choose a currency before filtering amounts.');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) throw new HttpError(400, `Invalid ${key}.`);
    replacements[key] = Number(value); conditions.push(`c.total ${operator} :${key}`);
  }
  if (minAmount && maxAmount && Number(minAmount) > Number(maxAmount)) throw new HttpError(400, 'Minimum amount cannot exceed maximum amount.');
  const itemConditions: string[] = [];
  const productId = scalar(query, 'productId');
  if (productId) {
    integer(productId, 0, Number.MAX_SAFE_INTEGER, 'product');
    replacements.productId = String(Number(productId)); itemConditions.push("item->>'productId' = :productId");
  }
  for (const group of ['activity', 'experience']) {
    const from = date(query, `${group}From`), to = date(query, `${group}To`);
    if (from && to && from > to) throw new HttpError(400, 'Start date cannot be after end date.');
    if (from) replacements[`${group}From`] = from;
    if (to) replacements[`${group}To`] = to;
    if (group === 'experience') {
      if (from) itemConditions.push("item->>'experienceDate' >= :experienceFrom");
      if (to) itemConditions.push("item->>'experienceDate' <= :experienceTo");
    } else {
      if (from) conditions.push("c.last_activity_at >= (CAST(:activityFrom AS date)::timestamp AT TIME ZONE 'Europe/Warsaw')");
      if (to) conditions.push("c.last_activity_at < ((CAST(:activityTo AS date) + 1)::timestamp AT TIME ZONE 'Europe/Warsaw')");
    }
  }
  if (itemConditions.length) conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(${ITEMS}) item WHERE ${itemConditions.join(' AND ')})`);
  return { page, pageSize, sort, where: conditions.join(' AND '), order: `${SORTS[sort]}, c.id DESC`, replacements };
}

type SummaryRow = { total: string; checkoutStarted: string; recoverySent: string; recoveryOpened: string };
type FacetRow = { kind: 'product' | 'country' | 'currency'; value: string; label: string };

export async function listOngoingCartPage(query: Record<string, unknown>) {
  const parsed = ongoingCartListQuery(query);
  // Counts and rows use one database snapshot, including when a cart changes status during retrieval.
  return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async transaction => {
    const options = { replacements: parsed.replacements, transaction, type: QueryTypes.SELECT as const };
    const summaries = await sequelize.query<SummaryRow>(`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE c.checkout_started_at IS NOT NULL) AS "checkoutStarted",
        COUNT(*) FILTER (WHERE ${SENT}) AS "recoverySent",
        COUNT(*) FILTER (WHERE c.recovery_opened_at IS NOT NULL) AS "recoveryOpened"
      FROM storefront_ongoing_carts c WHERE ${parsed.where}`, options);
    const raw = summaries[0];
    const summary = { total: Number(raw?.total ?? 0), checkoutStarted: Number(raw?.checkoutStarted ?? 0), recoverySent: Number(raw?.recoverySent ?? 0), recoveryOpened: Number(raw?.recoveryOpened ?? 0) };
    const totalPages = Math.max(1, Math.ceil(summary.total / parsed.pageSize));
    const page = Math.min(parsed.page, totalPages);
    const rows = await sequelize.query<StorefrontOngoingCart>(`
      SELECT c.* FROM storefront_ongoing_carts c WHERE ${parsed.where}
      ORDER BY ${parsed.order} LIMIT :limit OFFSET :offset`, {
      ...options, replacements: { ...parsed.replacements, limit: parsed.pageSize, offset: (page - 1) * parsed.pageSize },
      model: StorefrontOngoingCart, mapToModel: true,
    });
    const facets = await sequelize.query<FacetRow>(`
      WITH carts AS (SELECT c.customer, c.currency, ${ITEMS} AS items FROM storefront_ongoing_carts c WHERE ${ACTIVE})
      SELECT 'product' AS kind, item->>'productId' AS value, MAX(item->>'productName') AS label
      FROM carts, jsonb_array_elements(items) item WHERE item->>'productId' ~ '^[0-9]+$' GROUP BY item->>'productId'
      UNION ALL SELECT DISTINCT 'country', UPPER(customer->>'phoneCountry'), UPPER(customer->>'phoneCountry') FROM carts WHERE customer->>'phoneCountry' ~* '^[A-Z]{2}$'
      UNION ALL SELECT DISTINCT 'currency', currency, currency FROM carts WHERE currency IS NOT NULL
      ORDER BY label, value`, { transaction, type: QueryTypes.SELECT });
    return {
      rows, summary, pagination: { page, pageSize: parsed.pageSize, total: summary.total, totalPages },
      filters: {
        products: facets.filter(row => row.kind === 'product').map(row => ({ value: row.value, label: row.label || `Product #${row.value}` })),
        countries: facets.filter(row => row.kind === 'country').map(row => row.value),
        currencies: facets.filter(row => row.kind === 'currency').map(row => row.value),
      },
    };
  });
}
