import { DataTypes, type QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TEAM_ASSIGNMENTS = 'promotion_team_assignments';

// Keep this migration directly after the production-applied 202610060002
// boundary. The original backdated filename caused preflight to fail closed.

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.addColumn(TEAM_ASSIGNMENTS, 'shift_assignment_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'shift_assignments', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }, { transaction });
    await context.addIndex(TEAM_ASSIGNMENTS, ['shift_assignment_id'], {
      name: 'promo_team_assignments_shift_assignment_idx',
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.removeIndex(TEAM_ASSIGNMENTS, 'promo_team_assignments_shift_assignment_idx', { transaction });
    await context.removeColumn(TEAM_ASSIGNMENTS, 'shift_assignment_id', { transaction });
  });
}
