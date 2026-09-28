import { DataTypes, type QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TEMPLATES = 'whatsapp_templates';
const EVENTS = 'whatsapp_template_events';
const SENDS = 'whatsapp_template_sends';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(TEMPLATES, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      waba_id: { type: DataTypes.STRING(64), allowNull: false },
      meta_template_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(512), allowNull: false },
      language: { type: DataTypes.STRING(32), allowNull: false },
      category: { type: DataTypes.STRING(32), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      quality_score: { type: DataTypes.STRING(16), allowNull: true },
      parameter_format: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'POSITIONAL' },
      components: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      booking_bindings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      message_send_ttl_seconds: { type: DataTypes.INTEGER, allowNull: true },
      previous_category: { type: DataTypes.STRING(32), allowNull: true },
      correct_category: { type: DataTypes.STRING(32), allowNull: true },
      rejected_reason: { type: DataTypes.STRING(128), allowNull: true },
      reason_info: { type: DataTypes.TEXT, allowNull: true },
      recommendation_info: { type: DataTypes.TEXT, allowNull: true },
      provider_updated_at: { type: DataTypes.DATE, allowNull: true },
      last_synced_at: { type: DataTypes.DATE, allowNull: false },
      definition_hash: { type: DataTypes.STRING(64), allowNull: false },
      local_state: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'synced' },
      status_updated_at: { type: DataTypes.DATE, allowNull: true },
      quality_updated_at: { type: DataTypes.DATE, allowNull: true },
      category_updated_at: { type: DataTypes.DATE, allowNull: true },
      components_updated_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updated_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await context.addIndex(TEMPLATES, ['waba_id', 'meta_template_id'], {
      name: 'whatsapp_templates_waba_meta_key', unique: true, transaction,
    });
    await context.addIndex(TEMPLATES, ['waba_id', 'name', 'language'], {
      // A deleted template name can eventually be reused by Meta under a new
      // provider id. Keep the tombstone for history without blocking that row.
      name: 'whatsapp_templates_waba_name_language_idx', transaction,
    });
    await context.addIndex(TEMPLATES, ['status', 'quality_score'], {
      name: 'whatsapp_templates_status_quality_idx', transaction,
    });

    await context.createTable(EVENTS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      template_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: TEMPLATES, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      meta_template_id: { type: DataTypes.STRING(64), allowNull: false },
      event_type: { type: DataTypes.STRING(64), allowNull: false },
      event_value: { type: DataTypes.STRING(128), allowNull: true },
      previous_value: { type: DataTypes.STRING(128), allowNull: true },
      source: { type: DataTypes.STRING(24), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true },
      fingerprint: { type: DataTypes.STRING(64), allowNull: true },
      actor_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await context.addIndex(EVENTS, ['template_id', 'occurred_at'], {
      name: 'whatsapp_template_events_template_time_idx', transaction,
    });
    await context.addIndex(EVENTS, ['meta_template_id', 'occurred_at'], {
      name: 'whatsapp_template_events_meta_time_idx', transaction,
    });
    await context.addIndex(EVENTS, ['fingerprint'], {
      name: 'whatsapp_template_events_fingerprint_key', unique: true, transaction,
    });

    await context.createTable(SENDS, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      template_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: TEMPLATES, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      booking_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      provider_message_id: { type: DataTypes.STRING(256), allowNull: false },
      template_name: { type: DataTypes.STRING(512), allowNull: false },
      language: { type: DataTypes.STRING(32), allowNull: false },
      recipient_phone_suffix: { type: DataTypes.STRING(8), allowNull: true },
      parameter_keys: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      delivery_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'accepted' },
      delivery_error_code: { type: DataTypes.STRING(64), allowNull: true },
      status_updated_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });
    await context.addIndex(SENDS, ['provider_message_id'], {
      name: 'whatsapp_template_sends_provider_key', unique: true, transaction,
    });
    await context.addIndex(SENDS, ['booking_id', 'created_at'], {
      name: 'whatsapp_template_sends_booking_time_idx', transaction,
    });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.dropTable(SENDS, { transaction });
    await context.dropTable(EVENTS, { transaction });
    await context.dropTable(TEMPLATES, { transaction });
  });
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [templates, events, sends] = await Promise.all([
    context.describeTable(TEMPLATES),
    context.describeTable(EVENTS),
    context.describeTable(SENDS),
  ]);
  const details = {
    templates: Boolean(templates.meta_template_id && templates.components && templates.booking_bindings && templates.status),
    events: Boolean(events.meta_template_id && events.event_type && events.occurred_at && events.fingerprint),
    sends: Boolean(sends.provider_message_id && sends.template_id && sends.booking_id),
  };
  return { ok: Object.values(details).every(Boolean), details };
}
