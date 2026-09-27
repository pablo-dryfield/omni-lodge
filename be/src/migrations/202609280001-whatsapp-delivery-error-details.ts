import { DataTypes, type QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'whatsapp_messages';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    const existingColumns = await (context as any).describeTable(
      TABLE,
      { transaction },
    ) as Record<string, unknown>;

    if (!('delivery_error_code' in existingColumns)) {
      await context.addColumn(TABLE, 'delivery_error_code', {
        type: DataTypes.STRING(32),
        allowNull: true,
      }, { transaction });
    }
    if (!('delivery_error_title' in existingColumns)) {
      await context.addColumn(TABLE, 'delivery_error_title', {
        type: DataTypes.STRING(256),
        allowNull: true,
      }, { transaction });
    }
    if (!('delivery_error_details' in existingColumns)) {
      await context.addColumn(TABLE, 'delivery_error_details', {
        type: DataTypes.STRING(512),
        allowNull: true,
      }, { transaction });
    }
    if (!('delivery_error_updated_at' in existingColumns)) {
      await context.addColumn(TABLE, 'delivery_error_updated_at', {
        type: DataTypes.DATE,
        allowNull: true,
      }, { transaction });
    }
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    const existingColumns = await (context as any).describeTable(
      TABLE,
      { transaction },
    ) as Record<string, unknown>;

    if ('delivery_error_updated_at' in existingColumns) {
      await context.removeColumn(TABLE, 'delivery_error_updated_at', { transaction });
    }
    if ('delivery_error_details' in existingColumns) {
      await context.removeColumn(TABLE, 'delivery_error_details', { transaction });
    }
    if ('delivery_error_title' in existingColumns) {
      await context.removeColumn(TABLE, 'delivery_error_title', { transaction });
    }
    if ('delivery_error_code' in existingColumns) {
      await context.removeColumn(TABLE, 'delivery_error_code', { transaction });
    }
  });
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const columns = await context.describeTable(TABLE);
  const details = {
    deliveryErrorCodePresent: Boolean(columns.delivery_error_code),
    deliveryErrorTitlePresent: Boolean(columns.delivery_error_title),
    deliveryErrorDetailsPresent: Boolean(columns.delivery_error_details),
    deliveryErrorUpdatedAtPresent: Boolean(columns.delivery_error_updated_at),
  };
  return { ok: Object.values(details).every(Boolean), details };
}
