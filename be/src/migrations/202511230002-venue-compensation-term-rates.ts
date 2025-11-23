import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TERM_RATES_TABLE = 'venue_compensation_term_rates';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TERM_RATES_TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        termId: {
          field: 'term_id',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'venue_compensation_terms',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        productId: {
          field: 'product_id',
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'products',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        ticketType: {
          field: 'ticket_type',
          type: DataTypes.ENUM('normal', 'cocktail', 'brunch', 'generic'),
          allowNull: false,
          defaultValue: 'generic',
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
      TERM_RATES_TABLE,
      ['term_id', 'product_id', 'ticket_type', 'valid_from', 'valid_to'],
      {
        name: 'venue_comp_term_rates_lookup_idx',
        transaction,
      },
    );

    await qi.sequelize.query(
      `
      INSERT INTO ${TERM_RATES_TABLE} (
        term_id,
        product_id,
        ticket_type,
        rate_amount,
        rate_unit,
        valid_from,
        valid_to,
        is_active,
        created_at,
        updated_at
      )
      SELECT
        id AS term_id,
        NULL::INTEGER AS product_id,
        'generic'::TEXT AS ticket_type,
        rate_amount,
        rate_unit,
        valid_from,
        valid_to,
        is_active,
        created_at,
        updated_at
      FROM venue_compensation_terms
      WHERE rate_amount IS NOT NULL
    `,
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
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.removeIndex(TERM_RATES_TABLE, 'venue_comp_term_rates_lookup_idx', { transaction }).catch(() => {});
    await qi.dropTable(TERM_RATES_TABLE, { transaction }).catch(() => {});
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_venue_compensation_term_rates_ticket_type"', { transaction });
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_venue_compensation_term_rates_rate_unit"', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

