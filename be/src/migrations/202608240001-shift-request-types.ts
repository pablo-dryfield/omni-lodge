import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const REQUEST_TYPE_ENUM = 'enum_swap_requests_request_type';
const FROM_ASSIGNMENT_FK = 'swap_requests_from_assignment_id_fkey';
const TO_ASSIGNMENT_FK = 'swap_requests_to_assignment_id_fkey';
const PARTNER_FK = 'swap_requests_partner_id_fkey';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.addColumn(
      'swap_requests',
      'request_type',
      {
        type: DataTypes.ENUM('swap', 'takeover', 'drop'),
        allowNull: false,
        defaultValue: 'swap',
      },
      { transaction },
    );
    await context.addColumn(
      'swap_requests',
      'request_note',
      { type: DataTypes.TEXT, allowNull: true },
      { transaction },
    );
    await context.addColumn(
      'swap_requests',
      'partner_response_note',
      { type: DataTypes.TEXT, allowNull: true },
      { transaction },
    );
    await context.addColumn(
      'swap_requests',
      'assignment_snapshot',
      { type: DataTypes.JSONB, allowNull: true },
      { transaction },
    );

    await context.removeConstraint('swap_requests', FROM_ASSIGNMENT_FK, { transaction });
    await context.removeConstraint('swap_requests', TO_ASSIGNMENT_FK, { transaction });
    await context.removeConstraint('swap_requests', PARTNER_FK, { transaction });

    await context.changeColumn(
      'swap_requests',
      'from_assignment_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );
    await context.changeColumn(
      'swap_requests',
      'to_assignment_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );
    await context.changeColumn(
      'swap_requests',
      'partner_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );

    await context.addConstraint('swap_requests', {
      type: 'foreign key',
      name: FROM_ASSIGNMENT_FK,
      fields: ['from_assignment_id'],
      references: { table: 'shift_assignments', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });
    await context.addConstraint('swap_requests', {
      type: 'foreign key',
      name: TO_ASSIGNMENT_FK,
      fields: ['to_assignment_id'],
      references: { table: 'shift_assignments', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });
    await context.addConstraint('swap_requests', {
      type: 'foreign key',
      name: PARTNER_FK,
      fields: ['partner_id'],
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });

    await context.addIndex('swap_requests', ['request_type', 'status'], {
      name: 'swap_requests_type_status_idx',
      transaction,
    });
    await context.addIndex('swap_requests', ['from_assignment_id', 'status'], {
      name: 'swap_requests_from_assignment_status_idx',
      transaction,
    });
    await context.addIndex('swap_requests', ['to_assignment_id', 'status'], {
      name: 'swap_requests_to_assignment_status_idx',
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(
      `
        DELETE FROM "swap_requests"
        WHERE "request_type" <> 'swap'
           OR "from_assignment_id" IS NULL
           OR "to_assignment_id" IS NULL
           OR "partner_id" IS NULL
      `,
      { transaction },
    );
    await context.removeIndex('swap_requests', 'swap_requests_to_assignment_status_idx', { transaction });
    await context.removeIndex('swap_requests', 'swap_requests_from_assignment_status_idx', { transaction });
    await context.removeIndex('swap_requests', 'swap_requests_type_status_idx', { transaction });
    await context.removeConstraint('swap_requests', FROM_ASSIGNMENT_FK, { transaction });
    await context.removeConstraint('swap_requests', TO_ASSIGNMENT_FK, { transaction });
    await context.removeConstraint('swap_requests', PARTNER_FK, { transaction });
    await context.changeColumn(
      'swap_requests',
      'from_assignment_id',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      { transaction },
    );
    await context.changeColumn(
      'swap_requests',
      'to_assignment_id',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      { transaction },
    );
    await context.changeColumn(
      'swap_requests',
      'partner_id',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      { transaction },
    );
    await context.addConstraint('swap_requests', {
      type: 'foreign key',
      name: FROM_ASSIGNMENT_FK,
      fields: ['from_assignment_id'],
      references: { table: 'shift_assignments', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      transaction,
    });
    await context.addConstraint('swap_requests', {
      type: 'foreign key',
      name: TO_ASSIGNMENT_FK,
      fields: ['to_assignment_id'],
      references: { table: 'shift_assignments', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      transaction,
    });
    await context.addConstraint('swap_requests', {
      type: 'foreign key',
      name: PARTNER_FK,
      fields: ['partner_id'],
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      transaction,
    });
    await context.removeColumn('swap_requests', 'assignment_snapshot', { transaction });
    await context.removeColumn('swap_requests', 'partner_response_note', { transaction });
    await context.removeColumn('swap_requests', 'request_note', { transaction });
    await context.removeColumn('swap_requests', 'request_type', { transaction });
  });

  await context.sequelize.query(`DROP TYPE IF EXISTS "${REQUEST_TYPE_ENUM}";`);
}
