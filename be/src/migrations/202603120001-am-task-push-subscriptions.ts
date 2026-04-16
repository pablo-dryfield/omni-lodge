import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_NAME = 'am_task_push_subscriptions';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE_NAME,
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        endpoint: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        p256dh: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        auth: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        expiration_time: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
        user_agent: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        last_success_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        last_failure_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        last_failure_reason: {
          type: DataTypes.TEXT,
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
      },
      { transaction },
    );

    await qi.addIndex(TABLE_NAME, ['user_id'], {
      name: 'am_task_push_subscriptions_user_idx',
      transaction,
    });
    await qi.addIndex(TABLE_NAME, ['is_active'], {
      name: 'am_task_push_subscriptions_active_idx',
      transaction,
    });
    await qi.addIndex(TABLE_NAME, ['endpoint'], {
      name: 'am_task_push_subscriptions_endpoint_uq',
      unique: true,
      transaction,
    });

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
    await qi.removeIndex(TABLE_NAME, 'am_task_push_subscriptions_endpoint_uq', {
      transaction,
    }).catch(() => {});
    await qi.removeIndex(TABLE_NAME, 'am_task_push_subscriptions_active_idx', {
      transaction,
    }).catch(() => {});
    await qi.removeIndex(TABLE_NAME, 'am_task_push_subscriptions_user_idx', {
      transaction,
    }).catch(() => {});
    await qi.dropTable(TABLE_NAME, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

