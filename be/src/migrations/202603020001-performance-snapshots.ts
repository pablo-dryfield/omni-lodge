import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_NAME = 'performance_snapshots';
const INDEX_CAPTURED_AT = 'performance_snapshots_captured_at_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_NAME, {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    captured_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    cpu_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 0,
    },
    rss_mb: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    heap_used_mb: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    heap_used_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 0,
    },
    event_loop_lag_ms: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    event_loop_utilization: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 0,
    },
    active_requests: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    request_rate_per_minute: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    average_response_ms: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    p95_response_ms: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    error_rate_percent: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 0,
    },
    slow_request_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    db_pending: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    db_borrowed: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    system_memory_used_percent: {
      type: DataTypes.DECIMAL(8, 2),
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

  await qi.addIndex(TABLE_NAME, ['captured_at'], {
    name: INDEX_CAPTURED_AT,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeIndex(TABLE_NAME, INDEX_CAPTURED_AT).catch(() => {});
  await qi.dropTable(TABLE_NAME);
}
