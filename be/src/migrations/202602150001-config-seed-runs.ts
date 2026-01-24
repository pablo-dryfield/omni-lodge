import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_CONFIG_SEED_RUNS = 'config_seed_runs';
const TABLE_USERS = 'users';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_CONFIG_SEED_RUNS, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    seed_key: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    run_type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'auto',
    },
    seeded_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    seeded_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    seed_details: {
      type: DataTypes.JSONB,
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

  await qi.addIndex(TABLE_CONFIG_SEED_RUNS, ['seed_key', 'run_type'], {
    name: 'config_seed_runs_seed_key_run_type_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_CONFIG_SEED_RUNS);
}
