import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_MIGRATION_RUNS = 'migration_audit_runs';
const TABLE_MIGRATION_STEPS = 'migration_audit_steps';

async function tableExists(qi: QueryInterface, tableName: string): Promise<boolean> {
  const [rows] = await qi.sequelize.query(
    'SELECT to_regclass(:tableName) AS name',
    { replacements: { tableName: `public.${tableName}` } },
  );
  const row = rows as Array<{ name: string | null }>;
  return Boolean(row[0]?.name);
}

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  if (!(await tableExists(qi, TABLE_MIGRATION_RUNS))) {
    await qi.createTable(TABLE_MIGRATION_RUNS, {
      id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      run_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      direction: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      finished_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      node_env: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      db_name: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      error_stack: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    });
  }

  if (!(await tableExists(qi, TABLE_MIGRATION_STEPS))) {
    await qi.createTable(TABLE_MIGRATION_STEPS, {
      id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      run_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      direction: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      migration_name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      finished_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      error_stack: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      verify_status: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      verify_details: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    });
  }

  await qi.sequelize.query(`
    CREATE INDEX IF NOT EXISTS migration_audit_runs_run_id_idx
    ON ${TABLE_MIGRATION_RUNS} (run_id);
  `);
  await qi.sequelize.query(`
    CREATE INDEX IF NOT EXISTS migration_audit_steps_run_id_idx
    ON ${TABLE_MIGRATION_STEPS} (run_id);
  `);
  await qi.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS migration_audit_steps_run_migration_idx
    ON ${TABLE_MIGRATION_STEPS} (run_id, migration_name, direction);
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  if (await tableExists(qi, TABLE_MIGRATION_STEPS)) {
    await qi.dropTable(TABLE_MIGRATION_STEPS);
  }
  if (await tableExists(qi, TABLE_MIGRATION_RUNS)) {
    await qi.dropTable(TABLE_MIGRATION_RUNS);
  }
}

export async function verify({ context }: MigrationParams): Promise<string[]> {
  const qi = context;
  const missing: string[] = [];

  if (!(await tableExists(qi, TABLE_MIGRATION_RUNS))) {
    missing.push(TABLE_MIGRATION_RUNS);
  }
  if (!(await tableExists(qi, TABLE_MIGRATION_STEPS))) {
    missing.push(TABLE_MIGRATION_STEPS);
  }

  return missing;
}
