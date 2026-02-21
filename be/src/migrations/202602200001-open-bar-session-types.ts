import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_SESSION_TYPES = 'open_bar_session_types';
const TABLE_SESSIONS = 'open_bar_sessions';
const FK_SESSION_TYPE = 'open_bar_sessions_session_type_id_fkey';
const CHECK_TIME_LIMIT = 'open_bar_sessions_time_limit_minutes_chk';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE_SESSION_TYPES,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(160),
          allowNull: false,
        },
        slug: {
          type: DataTypes.STRING(160),
          allowNull: false,
          unique: true,
        },
        default_time_limit_minutes: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 60,
        },
        sort_order: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
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
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_SESSION_TYPES, ['is_active', 'sort_order'], {
      name: 'open_bar_session_types_active_sort_idx',
      transaction,
    });

    await qi.addColumn(
      TABLE_SESSIONS,
      'session_type_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_SESSIONS,
      'time_limit_minutes',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_SESSIONS, {
      type: 'foreign key',
      name: FK_SESSION_TYPE,
      fields: ['session_type_id'],
      references: {
        table: TABLE_SESSION_TYPES,
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_SESSIONS}
      ADD CONSTRAINT ${CHECK_TIME_LIMIT}
      CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0);
      `,
      { transaction },
    );

    const seedRows = [
      { name: 'Pub Crawl', slug: 'pub_crawl', defaultTimeLimitMinutes: 120, sortOrder: 10 },
      { name: 'Bottomless Brunch', slug: 'bottomless_brunch', defaultTimeLimitMinutes: 90, sortOrder: 20 },
      { name: 'Life Drawing Session', slug: 'life_drawing_session', defaultTimeLimitMinutes: 60, sortOrder: 30 },
    ];

    for (const row of seedRows) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_SESSION_TYPES}
          (name, slug, default_time_limit_minutes, sort_order, is_active, created_at, updated_at)
        VALUES
          (:name, :slug, :defaultTimeLimitMinutes, :sortOrder, true, NOW(), NOW())
        ON CONFLICT (slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          default_time_limit_minutes = EXCLUDED.default_time_limit_minutes,
          sort_order = EXCLUDED.sort_order,
          is_active = true,
          updated_at = NOW();
        `,
        { transaction, replacements: row },
      );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.removeConstraint(TABLE_SESSIONS, CHECK_TIME_LIMIT, { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE_SESSIONS, FK_SESSION_TYPE, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_SESSIONS, 'time_limit_minutes', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_SESSIONS, 'session_type_id', { transaction }).catch(() => {});
    await qi.dropTable(TABLE_SESSION_TYPES, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
