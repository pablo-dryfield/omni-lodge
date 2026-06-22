import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_NAME = 'booking_utm_catalog';
const INDEX_UNIQUE = 'booking_utm_catalog_field_normalized_unique_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable(TABLE_NAME, {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    field: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    value: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    normalized_value: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    first_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await context.addIndex(TABLE_NAME, ['field', 'normalized_value'], {
    name: INDEX_UNIQUE,
    unique: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable(TABLE_NAME);
}
