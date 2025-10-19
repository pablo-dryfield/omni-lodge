import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const OPEN_BAR_VENUES = [
  'Alternatywy',
  'RIN',
  "N'Joy",
  'Spolem Deluxe',
  'Społem Deluxe',
  "Spo�'em Deluxe",
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      'venues',
      'allows_open_bar',
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      { transaction },
    );

    await qi.bulkUpdate(
      'venues',
      { allows_open_bar: true },
      { name: { [Op.in]: OPEN_BAR_VENUES } },
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
  await qi.removeColumn('venues', 'allows_open_bar');
}

