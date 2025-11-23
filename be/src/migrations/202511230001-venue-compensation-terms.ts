import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const VENUE_COMPENSATION_TERMS_TABLE = 'venue_compensation_terms';
const NIGHT_REPORT_VENUES_TABLE = 'night_report_venues';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      VENUE_COMPENSATION_TERMS_TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        venueId: {
          field: 'venue_id',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'venues',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        compensationType: {
          field: 'compensation_type',
          type: DataTypes.ENUM('open_bar', 'commission'),
          allowNull: false,
        },
        direction: {
          field: 'direction',
          type: DataTypes.ENUM('payable', 'receivable'),
          allowNull: false,
        },
        rateAmount: {
          field: 'rate_amount',
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        rateUnit: {
          field: 'rate_unit',
          type: DataTypes.ENUM('per_person', 'flat'),
          allowNull: false,
          defaultValue: 'per_person',
        },
        currencyCode: {
          field: 'currency_code',
          type: DataTypes.STRING(3),
          allowNull: false,
          defaultValue: 'USD',
        },
        validFrom: {
          field: 'valid_from',
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        validTo: {
          field: 'valid_to',
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        isActive: {
          field: 'is_active',
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        createdBy: {
          field: 'created_by',
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updatedBy: {
          field: 'updated_by',
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        createdAt: {
          field: 'created_at',
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updatedAt: {
          field: 'updated_at',
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(
      VENUE_COMPENSATION_TERMS_TABLE,
      ['venue_id', 'compensation_type', 'valid_from', 'valid_to'],
      {
        name: 'venue_comp_terms_range_idx',
        transaction,
      },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'venue_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'venues',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'compensation_term_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: VENUE_COMPENSATION_TERMS_TABLE,
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'compensation_type',
      {
        type: DataTypes.ENUM('open_bar', 'commission'),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'direction',
      {
        type: DataTypes.ENUM('payable', 'receivable'),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'rate_applied',
      {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'rate_unit',
      {
        type: DataTypes.ENUM('per_person', 'flat'),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'payout_amount',
      {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      NIGHT_REPORT_VENUES_TABLE,
      'currency_code',
      {
        type: DataTypes.STRING(3),
        allowNull: true,
        defaultValue: 'USD',
      },
      { transaction },
    );

    await qi.addIndex(
      NIGHT_REPORT_VENUES_TABLE,
      ['venue_id', 'compensation_term_id'],
      {
        name: 'night_report_venues_comp_term_idx',
        transaction,
      },
    );

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
    await qi.removeIndex(NIGHT_REPORT_VENUES_TABLE, 'night_report_venues_comp_term_idx', { transaction }).catch(() => {});

    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'currency_code', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'payout_amount', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'rate_applied', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'rate_unit', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'direction', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'compensation_type', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'compensation_term_id', { transaction }).catch(() => {});
    await qi.removeColumn(NIGHT_REPORT_VENUES_TABLE, 'venue_id', { transaction }).catch(() => {});

    await qi.removeIndex(VENUE_COMPENSATION_TERMS_TABLE, 'venue_comp_terms_range_idx', { transaction }).catch(() => {});
    await qi.dropTable(VENUE_COMPENSATION_TERMS_TABLE, { transaction }).catch(() => {});

    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_venue_compensation_terms_compensation_type"', { transaction });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_venue_compensation_terms_direction"', { transaction });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_venue_compensation_terms_rate_unit"', { transaction });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_night_report_venues_compensation_type"', { transaction });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_night_report_venues_direction"', { transaction });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_night_report_venues_rate_unit"', { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
