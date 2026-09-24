import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };
type JsonRecord = Record<string, unknown>;

const CONFIG_KEY = 'BOOKING_DYNAMIC_PARSERS';
const CIVITATIS_SUBJECT_PATTERN = '^(?:New\\s+booking|Cancellation|Booking)\\s+[A-Z0-9]+(?:\\s+modified)?\\s*:';
const CIVITATIS_ORDER_ID_PATTERN = '^(?:New\\s+booking|Cancellation|Booking)\\s+([A-Z0-9]+)(?:\\s+modified)?\\s*:';
const CIVITATIS_CANCELLED_PATTERN = 'cancel(?:led|ed|lation)|cancelaci[oó]n';

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCivitatisParser = (entry: JsonRecord): boolean => {
  const platform = typeof entry.platform === 'string' ? entry.platform.trim().toLowerCase() : '';
  const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
  return platform === 'civitatis' || id === 'civitatis-v1' || id.startsWith('civitatis');
};

const updateFirstSubjectClause = (match: JsonRecord): { match: JsonRecord; changed: boolean } => {
  if (!Array.isArray(match.all)) return { match, changed: false };
  let changed = false;
  const all = match.all.map((clause) => {
    if (changed || !isRecord(clause) || clause.source !== 'subject') return clause;
    changed = true;
    return { ...clause, pattern: CIVITATIS_SUBJECT_PATTERN };
  });
  return { match: changed ? { ...match, all } : match, changed };
};

const updateCancelledClauses = (status: JsonRecord): { status: JsonRecord; changed: boolean } => {
  if (!Array.isArray(status.cancelled) || status.cancelled.length === 0) {
    return { status, changed: false };
  }
  let changed = false;
  const cancelled = status.cancelled.map((clause, index) => {
    if (index !== 0 || !isRecord(clause)) return clause;
    changed = true;
    return { ...clause, pattern: CIVITATIS_CANCELLED_PATTERN };
  });
  return { status: changed ? { ...status, cancelled } : status, changed };
};

export async function up({ context }: MigrationParams): Promise<void> {
  const [rows] = await context.sequelize.query('SELECT value FROM config_values WHERE key = :key', {
    replacements: { key: CONFIG_KEY },
  });
  const rawValue = (rows as Array<{ value: string | null }>)[0]?.value;
  if (!rawValue) return;

  let config: unknown;
  try {
    config = JSON.parse(rawValue);
  } catch {
    return;
  }
  if (!Array.isArray(config)) return;

  let changed = false;
  const next = config.map((entry) => {
    if (!isRecord(entry) || !isCivitatisParser(entry)) return entry;
    const matchResult = isRecord(entry.match)
      ? updateFirstSubjectClause(entry.match)
      : { match: entry.match, changed: false };
    const statusResult = isRecord(entry.status)
      ? updateCancelledClauses(entry.status)
      : { status: entry.status, changed: false };
    const extract = isRecord(entry.extract) ? entry.extract : null;
    const orderClause = extract && isRecord(extract.platformOrderId) ? extract.platformOrderId : null;
    const nextExtract = orderClause
      ? { ...extract, platformOrderId: { ...orderClause, pattern: CIVITATIS_ORDER_ID_PATTERN } }
      : extract;
    const extractChanged = Boolean(orderClause);
    changed ||= matchResult.changed || statusResult.changed || extractChanged;
    return {
      ...entry,
      match: matchResult.match,
      status: statusResult.status,
      ...(nextExtract ? { extract: nextExtract } : {}),
    };
  });

  if (!changed) return;
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(
      'UPDATE config_values SET value = :value, updated_at = NOW() WHERE key = :key',
      { replacements: { key: CONFIG_KEY, value: JSON.stringify(next) }, transaction },
    );
    await context.sequelize.query(
      `UPDATE booking_emails
       SET ingestion_status = 'pending', failure_reason = NULL, "updatedAt" = NOW()
       WHERE ingestion_status = 'ignored'
         AND from_address ILIKE '%@civitatis.com%'
         AND subject ~* '^(Cancellation\\s+[A-Z0-9]+|Booking\\s+[A-Z0-9]+\\s+modified)\\s*:'`,
      { transaction },
    );
  });
}

export async function down(): Promise<void> {
  // The prior rules dropped legitimate lifecycle messages. Do not restore data-loss behavior.
}
