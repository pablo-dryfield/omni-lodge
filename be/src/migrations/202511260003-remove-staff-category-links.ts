import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

const TABLE = 'staff_profiles';
const GUIDING_COLUMN = 'guiding_category_id';
const REVIEW_COLUMN = 'review_category_id';
const GUIDING_FK = 'staff_profiles_guiding_category_id_fkey';
const REVIEW_FK = 'staff_profiles_review_category_id_fkey';
const GUIDING_IDX = 'staff_profiles_guiding_category_idx';
const REVIEW_IDX = 'staff_profiles_review_category_idx';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.removeIndex(TABLE, GUIDING_IDX, { transaction }).catch(() => {});
    await qi.removeIndex(TABLE, REVIEW_IDX, { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE, GUIDING_FK, { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE, REVIEW_FK, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE, GUIDING_COLUMN, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE, REVIEW_COLUMN, { transaction }).catch(() => {});
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
    await qi.addColumn(
      TABLE,
      GUIDING_COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE,
      REVIEW_COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'finance_categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addConstraint(TABLE, {
      name: GUIDING_FK,
      type: 'foreign key',
      fields: [GUIDING_COLUMN],
      references: {
        table: 'finance_categories',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });

    await qi.addConstraint(TABLE, {
      name: REVIEW_FK,
      type: 'foreign key',
      fields: [REVIEW_COLUMN],
      references: {
        table: 'finance_categories',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });

    await qi.addIndex(TABLE, [GUIDING_COLUMN], { name: GUIDING_IDX, transaction });
    await qi.addIndex(TABLE, [REVIEW_COLUMN], { name: REVIEW_IDX, transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
