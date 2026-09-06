import { QueryTypes, type Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';

const CORRECTION_ACTION = 'social_media.publish_date_changed';

/**
 * Counts immutable correction audits before the report reads task completion.
 * Counts, rather than timestamps or maximum IDs, also detect a transaction
 * whose audit was inserted earlier but committed while the report was running.
 */
export const loadStaffPayoutTaskCorrectionVersions = async (): Promise<ReadonlyMap<number, string>> => {
  const rows = await sequelize.query<{ userId: string; version: string }>(
    `SELECT meta_json->>'userId' AS "userId", count(*)::text AS version
       FROM audit_logs
      WHERE entity = 'social_media_content' AND action = :action
      GROUP BY meta_json->>'userId'`,
    { replacements: { action: CORRECTION_ACTION }, type: QueryTypes.SELECT },
  );
  return new Map(rows.flatMap((row) => {
    const userId = Number(row.userId);
    return Number.isSafeInteger(userId) && userId > 0
      ? [[userId, String(row.version)] as const]
      : [];
  }));
};

/** Call after acquiring the staff User UPDATE lock, before writing the ledger. */
export const assertStaffPayoutTaskCorrectionVersionUnchanged = async (
  userId: number,
  versions: ReadonlyMap<number, string>,
  transaction: Transaction,
): Promise<void> => {
  const [row] = await sequelize.query<{ version: string }>(
    `SELECT count(*)::text AS version
       FROM audit_logs
      WHERE entity = 'social_media_content'
        AND action = :action AND meta_json->>'userId' = :userId`,
    {
      replacements: { action: CORRECTION_ACTION, userId: String(userId) },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  if (!row || String(row.version) !== (versions.get(userId) ?? '0')) {
    throw new HttpError(
      409,
      'A Social Media task publication date changed while Pays was calculating. Refresh Pays before continuing.',
    );
  }
};
