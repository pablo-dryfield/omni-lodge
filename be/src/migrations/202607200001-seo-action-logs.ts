import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'seo_action_logs';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable(TABLE, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    site_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    action_type: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    target_query: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    target_page: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await context.addIndex(TABLE, ['site_url', 'created_at'], {
    name: 'seo_action_logs_site_created_idx',
  });
  await context.addIndex(TABLE, ['target_query'], {
    name: 'seo_action_logs_query_idx',
  });
  await context.addIndex(TABLE, ['target_page'], {
    name: 'seo_action_logs_page_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable(TABLE);
}
