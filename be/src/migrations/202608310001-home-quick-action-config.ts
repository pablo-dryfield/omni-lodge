import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const CONFIG_TABLE = 'home_quick_action_configs';
const TARGET_TABLE = 'home_quick_action_targets';

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.createTable(
      CONFIG_TABLE,
      {
        action_key: {
          type: DataTypes.STRING(120),
          allowNull: false,
          primaryKey: true,
        },
        enabled: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        audience_mode: {
          type: DataTypes.STRING(24),
          allowNull: false,
          defaultValue: 'all',
        },
        sort_order: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
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
      },
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${CONFIG_TABLE}
         ADD CONSTRAINT home_quick_action_configs_audience_mode_ck
         CHECK (audience_mode IN ('all', 'targeted'));`,
      { transaction },
    );

    await context.createTable(
      TARGET_TABLE,
      {
        id: {
          type: DataTypes.BIGINT,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        action_key: {
          type: DataTypes.STRING(120),
          allowNull: false,
          references: { model: CONFIG_TABLE, key: 'action_key' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        effect: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'allow',
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        user_type_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'userTypes', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        shift_role_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'shift_roles', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        staff_profile_type: {
          type: DataTypes.STRING(64),
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

    await context.sequelize.query(
      `ALTER TABLE ${TARGET_TABLE}
         ADD CONSTRAINT home_quick_action_targets_effect_ck
         CHECK (effect IN ('allow', 'deny'));
       ALTER TABLE ${TARGET_TABLE}
         ADD CONSTRAINT home_quick_action_targets_one_subject_ck
         CHECK (num_nonnulls(user_id, user_type_id, shift_role_id, staff_profile_type) = 1);
       ALTER TABLE ${TARGET_TABLE}
         ADD CONSTRAINT home_quick_action_targets_staff_profile_type_ck
         CHECK (
           staff_profile_type IS NULL
           OR staff_profile_type IN ('volunteer', 'long_term', 'assistant_manager', 'manager', 'guide')
         );`,
      { transaction },
    );
    await context.addIndex(TARGET_TABLE, ['action_key'], {
      name: 'home_quick_action_targets_action_key_idx',
      transaction,
    });
    await context.addIndex(TARGET_TABLE, ['user_id'], {
      name: 'home_quick_action_targets_user_id_idx',
      transaction,
    });
    await context.addIndex(TARGET_TABLE, ['user_type_id'], {
      name: 'home_quick_action_targets_user_type_id_idx',
      transaction,
    });
    await context.addIndex(TARGET_TABLE, ['shift_role_id'], {
      name: 'home_quick_action_targets_shift_role_id_idx',
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.dropTable(TARGET_TABLE, { transaction });
    await context.dropTable(CONFIG_TABLE, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('${CONFIG_TABLE}', '${TARGET_TABLE}');`,
  );
  const found = new Set((rows as Array<{ table_name: string }>).map((row) => row.table_name));
  const missing = [CONFIG_TABLE, TARGET_TABLE].filter((table) => !found.has(table));
  return { ok: missing.length === 0, details: { missing } };
}
