import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable('shift_roles', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
    },
    slug: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: true,
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

  await qi.createTable('user_shift_roles', {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    shift_role_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'shift_roles',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
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

  await qi.addConstraint('user_shift_roles', {
    type: 'primary key',
    fields: ['user_id', 'shift_role_id'],
    name: 'user_shift_roles_pkey',
  });

  await qi.addColumn('shift_assignments', 'shift_role_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'shift_roles',
      key: 'id',
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.removeColumn('shift_assignments', 'shift_role_id').catch(() => {});
  await qi.dropTable('user_shift_roles').catch(() => {});
  await qi.dropTable('shift_roles').catch(() => {});
}

