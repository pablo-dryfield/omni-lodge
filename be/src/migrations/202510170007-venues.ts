import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

// Initial venue directory synced with operations on 2025-10-17.
const VENUE_NAMES = [
  'Frantic',
  "Let's Sing",
  'La Bodega Del Ron',
  'Prozak 2.0',
  'RIN',
  'Bracka 4',
  "N'Joy",
  'Four',
  'Familia Brazilian Bistro',
  'Space',
  'Shakers',
  'Coco',
  'Choice',
  'Cubano',
  'Oldsmobil',
  'Alternatywy',
  'Społem Deluxe',
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.createTable(
      'venues',
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          unique: true,
        },
        sort_order: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
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

    const now = new Date();
    await qi.bulkInsert(
      'venues',
      VENUE_NAMES.map((name, index) => ({
        name,
        sort_order: index + 1,
        is_active: true,
        created_at: now,
        updated_at: now,
      })),
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
  await qi.dropTable('venues');
}

