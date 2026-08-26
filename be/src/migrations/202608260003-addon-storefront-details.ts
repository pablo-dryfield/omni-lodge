import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ADDON_DETAILS = [
  {
    name: 'Cocktails',
    description: 'Pre-order cocktails for your group and have them included with your booking.',
    imageUrl: 'https://media.krawlthroughkrakow.com/addons/cocktails-6a07bcff05bd.webp',
  },
  {
    name: 'T-Shirts',
    description:
      'Take home an official Krawl Through Krakow T-shirt. Choose the quantity and assign a size to every shirt.',
    imageUrl: 'https://media.krawlthroughkrakow.com/addons/t-shirts-aff869eda2a9.webp',
  },
  {
    name: 'Photos',
    description: 'Capture the night with instant photos of your group during the experience.',
    imageUrl: 'https://media.krawlthroughkrakow.com/addons/photos-2d03da2c6c07.webp',
  },
] as const;

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn('addons', 'description', {
    type: DataTypes.TEXT,
    allowNull: true,
  });
  await context.addColumn('addons', 'image_url', {
    type: DataTypes.TEXT,
    allowNull: true,
  });

  for (const addon of ADDON_DETAILS) {
    await context.bulkUpdate(
      'addons',
      { description: addon.description, image_url: addon.imageUrl },
      { name: addon.name },
    );
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn('addons', 'image_url');
  await context.removeColumn('addons', 'description');
}

export async function verify({ context }: MigrationParams): Promise<boolean> {
  const columns = await context.describeTable('addons');
  return Boolean(columns.description && columns.image_url);
}
