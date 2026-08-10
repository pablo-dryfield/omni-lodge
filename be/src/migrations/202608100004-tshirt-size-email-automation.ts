import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.addColumn('bookings', 'tshirt_size_email_status', {
      type: DataTypes.STRING(20),
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_attempted_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_sent_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_message_id', {
      type: DataTypes.STRING(256),
      allowNull: true,
    }, { transaction });
    await context.addColumn('bookings', 'tshirt_size_email_error', {
      type: DataTypes.TEXT,
      allowNull: true,
    }, { transaction });
    await context.addIndex('bookings', ['tshirt_size_email_status'], {
      name: 'bookings_tshirt_size_email_status_idx',
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.removeIndex('bookings', 'bookings_tshirt_size_email_status_idx', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_error', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_message_id', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_sent_at', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_attempted_at', { transaction });
    await context.removeColumn('bookings', 'tshirt_size_email_status', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
