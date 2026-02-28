import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_UTM_SOURCE = 'utm_source';
const COLUMN_UTM_MEDIUM = 'utm_medium';
const COLUMN_UTM_CAMPAIGN = 'utm_campaign';
const INDEX_UTM_SOURCE = 'bookings_ecwid_utm_source_idx';
const INDEX_UTM_MEDIUM = 'bookings_ecwid_utm_medium_idx';
const INDEX_UTM_CAMPAIGN = 'bookings_ecwid_utm_campaign_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_BOOKINGS, COLUMN_UTM_SOURCE, {
    type: DataTypes.STRING(255),
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_UTM_MEDIUM, {
    type: DataTypes.STRING(255),
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_UTM_CAMPAIGN, {
    type: DataTypes.STRING(512),
    allowNull: true,
  });

  await qi.addIndex(TABLE_BOOKINGS, [COLUMN_UTM_SOURCE], {
    name: INDEX_UTM_SOURCE,
    where: {
      platform: 'ecwid',
    },
  });
  await qi.addIndex(TABLE_BOOKINGS, [COLUMN_UTM_MEDIUM], {
    name: INDEX_UTM_MEDIUM,
    where: {
      platform: 'ecwid',
    },
  });
  await qi.addIndex(TABLE_BOOKINGS, [COLUMN_UTM_CAMPAIGN], {
    name: INDEX_UTM_CAMPAIGN,
    where: {
      platform: 'ecwid',
    },
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.removeIndex(TABLE_BOOKINGS, INDEX_UTM_CAMPAIGN).catch(() => {});
  await qi.removeIndex(TABLE_BOOKINGS, INDEX_UTM_MEDIUM).catch(() => {});
  await qi.removeIndex(TABLE_BOOKINGS, INDEX_UTM_SOURCE).catch(() => {});

  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_UTM_CAMPAIGN);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_UTM_MEDIUM);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_UTM_SOURCE);
}
