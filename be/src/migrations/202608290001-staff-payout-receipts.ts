import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `ALTER TABLE finance_files
       ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'general'
         CHECK (purpose IN ('general', 'staff_payout_receipt'));`,
      { transaction },
    );
    // The original table-level SHA uniqueness is useful for ordinary invoices,
    // but payout evidence must remain immutable across cancelled/reissued
    // receipts. The same photo or signature may therefore be submitted again.
    await context.sequelize.query(
      `ALTER TABLE finance_files DROP CONSTRAINT IF EXISTS finance_files_sha256_key;
       DROP INDEX IF EXISTS finance_files_sha256_key;
       CREATE UNIQUE INDEX finance_files_general_sha256_uidx
         ON finance_files (sha256)
         WHERE purpose = 'general';`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE staff_payout_receipts (
        id SERIAL PRIMARY KEY,
        staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        required_action_id INTEGER NULL REFERENCES required_actions(id) ON DELETE SET NULL,
        payout_batch_key VARCHAR(128) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'completed', 'cancelled')),
        range_start DATE NOT NULL,
        range_end DATE NOT NULL,
        paid_date DATE NOT NULL,
        paid_by_name VARCHAR(255) NOT NULL,
        acceptance_version VARCHAR(32) NOT NULL DEFAULT 'v1',
        acceptance_text TEXT NOT NULL,
        photo_file_id INTEGER NULL REFERENCES finance_files(id) ON DELETE RESTRICT,
        signature_file_id INTEGER NULL REFERENCES finance_files(id) ON DELETE RESTRICT,
        confirmed_at TIMESTAMPTZ NULL,
        confirmed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        confirmation_ip VARCHAR(96) NULL,
        confirmation_user_agent TEXT NULL,
        client_acknowledged_at TIMESTAMPTZ NULL,
        cancelled_at TIMESTAMPTZ NULL,
        cancelled_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        cancel_reason TEXT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE staff_payout_receipt_items (
        id SERIAL PRIMARY KEY,
        receipt_id INTEGER NOT NULL REFERENCES staff_payout_receipts(id) ON DELETE CASCADE,
        collection_log_id INTEGER NULL REFERENCES staff_payout_collection_logs(id) ON DELETE SET NULL,
        collection_log_id_snapshot INTEGER NOT NULL,
        finance_transaction_id INTEGER NULL REFERENCES finance_transactions(id) ON DELETE SET NULL,
        finance_transaction_id_snapshot INTEGER NULL,
        label VARCHAR(255) NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency_code VARCHAR(3) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE UNIQUE INDEX staff_payout_receipts_active_batch_currency_uidx
       ON staff_payout_receipts (payout_batch_key)
       WHERE status IN ('pending', 'completed');`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE UNIQUE INDEX staff_payout_receipts_required_action_uidx
       ON staff_payout_receipts (required_action_id)
       WHERE required_action_id IS NOT NULL;`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE INDEX staff_payout_receipts_staff_status_idx
       ON staff_payout_receipts (staff_user_id, status, created_at DESC);`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE INDEX staff_payout_receipt_items_receipt_idx
       ON staff_payout_receipt_items (receipt_id);`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE UNIQUE INDEX staff_payout_receipt_items_live_collection_uidx
       ON staff_payout_receipt_items (collection_log_id)
       WHERE collection_log_id IS NOT NULL;`,
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
    await context.sequelize.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM finance_files WHERE purpose = 'staff_payout_receipt'
         ) THEN
           RAISE EXCEPTION 'Cannot remove staff payout receipt privacy metadata while evidence files exist';
         END IF;
       END $$;`,
      { transaction },
    );
    await context.sequelize.query('DROP TABLE IF EXISTS staff_payout_receipt_items;', { transaction });
    await context.sequelize.query('DROP TABLE IF EXISTS staff_payout_receipts;', { transaction });
    await context.sequelize.query('DROP INDEX IF EXISTS finance_files_general_sha256_uidx;', { transaction });
    await context.sequelize.query('ALTER TABLE finance_files DROP COLUMN IF EXISTS purpose;', { transaction });
    await context.sequelize.query(
      'ALTER TABLE finance_files ADD CONSTRAINT finance_files_sha256_key UNIQUE (sha256);',
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
