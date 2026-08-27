import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `ALTER TABLE config_keys
       ADD COLUMN IF NOT EXISTS is_revealable BOOLEAN NOT NULL DEFAULT TRUE,
       ADD COLUMN IF NOT EXISTS is_system_managed BOOLEAN NOT NULL DEFAULT FALSE;`,
  );
  await context.sequelize.query(
    `ALTER TABLE whatsapp_source_state
       DROP CONSTRAINT IF EXISTS whatsapp_source_state_history_sync_status_check;
     ALTER TABLE whatsapp_source_state
       ADD CONSTRAINT whatsapp_source_state_history_sync_status_check
       CHECK (history_sync_status IN ('not_started', 'in_progress', 'complete', 'declined', 'failed'));`,
  );

  await context.sequelize.query(
    `CREATE TABLE IF NOT EXISTS whatsapp_embedded_signup_attempts (
      id UUID PRIMARY KEY,
      admin_user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      nonce_hash CHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
      expires_at TIMESTAMPTZ NOT NULL,
      waba_id VARCHAR(64) NULL,
      phone_number_id VARCHAR(64) NULL,
      onboarding_generation VARCHAR(64) NULL,
      token_stored_at TIMESTAMPTZ NULL,
      subscription_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (subscription_status IN ('not_started', 'succeeded', 'failed', 'unknown')),
      subscription_attempted_at TIMESTAMPTZ NULL,
      subscribed_at TIMESTAMPTZ NULL,
      recovery_lease_at TIMESTAMPTZ NULL,
      app_state_sync_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (app_state_sync_status IN ('not_started', 'claimed', 'succeeded', 'failed', 'unknown')),
      app_state_sync_request_id VARCHAR(256) NULL,
      app_state_sync_claimed_at TIMESTAMPTZ NULL,
      app_state_sync_completed_at TIMESTAMPTZ NULL,
      history_sync_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (history_sync_status IN ('not_started', 'claimed', 'succeeded', 'failed', 'unknown')),
      history_sync_request_id VARCHAR(256) NULL,
      history_sync_claimed_at TIMESTAMPTZ NULL,
      history_sync_completed_at TIMESTAMPTZ NULL,
      error_code VARCHAR(64) NULL,
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_embedded_signup_attempts_admin_created_idx
       ON whatsapp_embedded_signup_attempts (admin_user_id, created_at DESC);`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_embedded_signup_attempts_status_expiry_idx
       ON whatsapp_embedded_signup_attempts (status, expires_at);`,
  );
  await context.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_embedded_signup_attempts_one_active_idx
       ON whatsapp_embedded_signup_attempts ((1))
       WHERE status IN ('pending', 'processing');`,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query('DROP TABLE IF EXISTS whatsapp_embedded_signup_attempts;');
  await context.sequelize.query(
    `UPDATE whatsapp_source_state SET history_sync_status = 'failed'
       WHERE history_sync_status = 'declined';
     ALTER TABLE whatsapp_source_state
       DROP CONSTRAINT IF EXISTS whatsapp_source_state_history_sync_status_check;
     ALTER TABLE whatsapp_source_state
       ADD CONSTRAINT whatsapp_source_state_history_sync_status_check
       CHECK (history_sync_status IN ('not_started', 'in_progress', 'complete', 'failed'));`,
  );
  await context.sequelize.query(
    `ALTER TABLE config_keys
       DROP COLUMN IF EXISTS is_system_managed,
       DROP COLUMN IF EXISTS is_revealable;`,
  );
}
