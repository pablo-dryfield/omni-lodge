import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_SECTIONS = 'cerebro_sections';
const TABLE_ENTRIES = 'cerebro_entries';
const TABLE_QUIZZES = 'cerebro_quizzes';
const TABLE_ATTEMPTS = 'cerebro_quiz_attempts';
const TABLE_ACKNOWLEDGEMENTS = 'cerebro_acknowledgements';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE_SECTIONS,
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        slug: { type: DataTypes.STRING(160), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(160), allowNull: false },
        description: { type: DataTypes.STRING(255), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: true },
      },
      { transaction },
    );

    await qi.createTable(
      TABLE_ENTRIES,
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        section_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_SECTIONS, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        slug: { type: DataTypes.STRING(180), allowNull: false, unique: true },
        title: { type: DataTypes.STRING(180), allowNull: false },
        category: { type: DataTypes.STRING(120), allowNull: true },
        kind: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'faq' },
        summary: { type: DataTypes.STRING(255), allowNull: true },
        body: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
        media: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        checklist_items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        target_user_type_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        requires_acknowledgement: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        policy_version: { type: DataTypes.STRING(80), allowNull: true },
        estimated_read_minutes: { type: DataTypes.INTEGER, allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: true },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_ENTRIES, ['section_id', 'sort_order'], {
      name: 'cerebro_entries_section_sort_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_QUIZZES,
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        entry_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: TABLE_ENTRIES, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        slug: { type: DataTypes.STRING(180), allowNull: false, unique: true },
        title: { type: DataTypes.STRING(180), allowNull: false },
        description: { type: DataTypes.STRING(255), allowNull: true },
        target_user_type_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        passing_score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 80 },
        questions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: true },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_QUIZZES, ['entry_id', 'sort_order'], {
      name: 'cerebro_quizzes_entry_sort_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_ATTEMPTS,
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        quiz_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_QUIZZES, key: 'id' },
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
        score_percent: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 0 },
        passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        answers: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        result_details: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        submitted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: true },
      },
      { transaction },
    );

    await qi.addIndex(TABLE_ATTEMPTS, ['quiz_id', 'user_id', 'submitted_at'], {
      name: 'cerebro_quiz_attempts_quiz_user_submitted_idx',
      transaction,
    });

    await qi.createTable(
      TABLE_ACKNOWLEDGEMENTS,
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        entry_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: TABLE_ENTRIES, key: 'id' },
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
        accepted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        version_accepted: { type: DataTypes.STRING(80), allowNull: false, defaultValue: '' },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: true },
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_ACKNOWLEDGEMENTS, {
      type: 'unique',
      name: 'cerebro_acknowledgements_entry_user_uq',
      fields: ['entry_id', 'user_id'],
      transaction,
    });

    await qi.addIndex(TABLE_ACKNOWLEDGEMENTS, ['user_id', 'accepted_at'], {
      name: 'cerebro_acknowledgements_user_accepted_idx',
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
    await qi.dropTable(TABLE_ACKNOWLEDGEMENTS, { transaction });
    await qi.dropTable(TABLE_ATTEMPTS, { transaction });
    await qi.dropTable(TABLE_QUIZZES, { transaction });
    await qi.dropTable(TABLE_ENTRIES, { transaction });
    await qi.dropTable(TABLE_SECTIONS, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
