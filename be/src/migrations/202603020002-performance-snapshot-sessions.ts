import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_NAME = 'performance_snapshots';
const INDEX_SESSION = 'performance_snapshots_session_idx';
const DEFAULT_LEGACY_SESSION_ID = 'legacy-pre-session-tracking';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_NAME, 'performance_session_id', {
    type: DataTypes.STRING(255),
    allowNull: true,
  });

  await qi.addColumn(TABLE_NAME, 'process_started_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });

  await qi.sequelize.query(`
    UPDATE ${TABLE_NAME}
    SET
      performance_session_id = '${DEFAULT_LEGACY_SESSION_ID}',
      process_started_at = (
        SELECT MIN(captured_at) FROM ${TABLE_NAME}
      )
    WHERE performance_session_id IS NULL OR process_started_at IS NULL
  `);

  await qi.changeColumn(TABLE_NAME, 'performance_session_id', {
    type: DataTypes.STRING(255),
    allowNull: false,
  });

  await qi.changeColumn(TABLE_NAME, 'process_started_at', {
    type: DataTypes.DATE,
    allowNull: false,
  });

  await qi.addIndex(TABLE_NAME, ['performance_session_id', 'captured_at'], {
    name: INDEX_SESSION,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeIndex(TABLE_NAME, INDEX_SESSION).catch(() => {});
  await qi.removeColumn(TABLE_NAME, 'process_started_at').catch(() => {});
  await qi.removeColumn(TABLE_NAME, 'performance_session_id').catch(() => {});
}
