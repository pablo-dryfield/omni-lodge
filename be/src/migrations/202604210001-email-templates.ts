import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_EMAIL_TEMPLATES = 'email_templates';
const TABLE_USERS = 'users';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE_EMAIL_TEMPLATES, {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    template_type: {
      type: DataTypes.ENUM('plain_text', 'react_email'),
      allowNull: false,
      defaultValue: 'plain_text',
    },
    subject_template: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
    body_template: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: TABLE_USERS, key: 'id' },
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
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addIndex(TABLE_EMAIL_TEMPLATES, ['is_active'], {
    name: 'email_templates_is_active_idx',
  });
  await qi.addIndex(TABLE_EMAIL_TEMPLATES, ['template_type'], {
    name: 'email_templates_type_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE_EMAIL_TEMPLATES);
  await qi.sequelize.query('DROP TYPE IF EXISTS "enum_email_templates_template_type";');
}
