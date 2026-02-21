import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_MEMBERSHIPS = 'open_bar_session_memberships';
const TABLE_SESSIONS = 'open_bar_sessions';
const ACTIVE_USER_UNIQUE_INDEX = 'open_bar_session_memberships_user_active_uq';
const SESSION_USER_UNIQUE_CONSTRAINT = 'open_bar_session_memberships_session_user_uq';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE_MEMBERSHIPS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        session_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_SESSIONS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        joined_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        left_at: {
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
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_MEMBERSHIPS, {
      type: 'unique',
      name: SESSION_USER_UNIQUE_CONSTRAINT,
      fields: ['session_id', 'user_id'],
      transaction,
    });

    await qi.addIndex(TABLE_MEMBERSHIPS, ['session_id'], {
      name: 'open_bar_session_memberships_session_idx',
      transaction,
    });

    await qi.addIndex(TABLE_MEMBERSHIPS, ['user_id', 'is_active'], {
      name: 'open_bar_session_memberships_user_active_idx',
      transaction,
    });

    await qi.sequelize.query(
      `
      CREATE UNIQUE INDEX ${ACTIVE_USER_UNIQUE_INDEX}
      ON ${TABLE_MEMBERSHIPS} (user_id)
      WHERE is_active = true;
      `,
      { transaction },
    );

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
    await qi.sequelize.query(`DROP INDEX IF EXISTS ${ACTIVE_USER_UNIQUE_INDEX};`, { transaction });
    await qi.removeConstraint(TABLE_MEMBERSHIPS, SESSION_USER_UNIQUE_CONSTRAINT, { transaction }).catch(() => {});
    await qi.dropTable(TABLE_MEMBERSHIPS, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
