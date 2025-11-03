import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable('report_templates', {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    name: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    schedule: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    models: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    fields: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    joins: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    visuals: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    metrics: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    filters: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    options: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {
        autoDistribution: true,
        notifyTeam: true,
      },
    },
    created_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex('report_templates', ['user_id'], {
    name: 'report_templates_user_id_idx',
  });

  await qi.addIndex('report_templates', ['name'], {
    name: 'report_templates_name_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable('report_templates');
}
