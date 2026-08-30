import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'staff_payout_settlement_requests';

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `CREATE TABLE ${TABLE} (
        id BIGSERIAL PRIMARY KEY,
        staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        request_id VARCHAR(128) NOT NULL,
        payout_batch_key VARCHAR(64) NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT staff_payout_settlement_request_id_ck
          CHECK (request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
        CONSTRAINT staff_payout_settlement_batch_key_ck
          CHECK (payout_batch_key ~ '^[a-f0-9]{64}$'),
        CONSTRAINT staff_payout_settlement_request_staff_uidx
          UNIQUE (staff_user_id, request_id)
      );
      CREATE INDEX staff_payout_settlement_request_batch_idx
        ON ${TABLE} (payout_batch_key);`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
