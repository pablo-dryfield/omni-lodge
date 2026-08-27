import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id BIGSERIAL PRIMARY KEY,
      phone_number_id VARCHAR(64) NOT NULL,
      provider_message_id VARCHAR(256) NOT NULL,
      direction VARCHAR(16) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      source VARCHAR(32) NOT NULL CHECK (source IN ('messages', 'history', 'smb_message_echoes')),
      message_type VARCHAR(64) NOT NULL,
      contact_key VARCHAR(64) NULL,
      contact_phone_suffix VARCHAR(8) NULL,
      contact_display_name VARCHAR(256) NULL,
      text_content TEXT NULL,
      context_provider_message_id VARCHAR(256) NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      content_updated_at TIMESTAMPTZ NULL,
      delivery_status VARCHAR(32) NULL,
      status_updated_at TIMESTAMPTZ NULL,
      edited_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );

  await context.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_phone_provider_unique
     ON whatsapp_messages (phone_number_id, provider_message_id);`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_messages_occurred_at_idx
     ON whatsapp_messages (occurred_at DESC);`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_messages_contact_occurred_idx
     ON whatsapp_messages (phone_number_id, contact_key, occurred_at DESC)
     WHERE contact_key IS NOT NULL;`,
  );

  await context.sequelize.query(
    `CREATE TABLE IF NOT EXISTS whatsapp_source_state (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      status VARCHAR(32) NOT NULL DEFAULT 'unavailable'
        CHECK (status IN ('unavailable', 'connected', 'degraded')),
      history_sync_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (history_sync_status IN ('not_started', 'in_progress', 'complete', 'failed')),
      history_sync_progress SMALLINT NULL
        CHECK (history_sync_progress BETWEEN 0 AND 100),
      last_webhook_at TIMESTAMPTZ NULL,
      last_successful_ingest_at TIMESTAMPTZ NULL,
      last_message_at TIMESTAMPTZ NULL,
      last_error_at TIMESTAMPTZ NULL,
      last_error_code VARCHAR(64) NULL,
      onboarding_generation VARCHAR(64) NULL,
      disconnected_generation VARCHAR(64) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );
  await context.sequelize.query(
    `INSERT INTO whatsapp_source_state (id)
     VALUES (1)
     ON CONFLICT (id) DO NOTHING;`,
  );

  await context.sequelize.query(
    `CREATE TABLE IF NOT EXISTS whatsapp_webhook_inbox (
      id BIGSERIAL PRIMARY KEY,
      delivery_hash VARCHAR(64) NOT NULL UNIQUE,
      payload_ciphertext BYTEA NOT NULL,
      payload_iv BYTEA NOT NULL,
      payload_auth_tag BYTEA NOT NULL,
      encryption_key_id VARCHAR(64) NOT NULL,
      onboarding_generation VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL,
      last_error_code VARCHAR(64) NULL,
      lease_token VARCHAR(64) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS whatsapp_webhook_inbox_ready_idx
     ON whatsapp_webhook_inbox (status, next_attempt_at);`,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query('DROP TABLE IF EXISTS whatsapp_webhook_inbox;');
  await context.sequelize.query('DROP TABLE IF EXISTS whatsapp_source_state;');
  await context.sequelize.query('DROP TABLE IF EXISTS whatsapp_messages;');
}
