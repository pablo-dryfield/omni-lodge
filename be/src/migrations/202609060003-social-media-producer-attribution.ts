import { DataTypes, type QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.addColumn('social_media_contents', 'produced_by', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    }, { transaction });
    // Earlier rows did not capture the producer. Leave them unknown rather
    // than incorrectly attributing production to the creator or last editor.
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn('social_media_contents', 'produced_by');
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const columns = await context.describeTable('social_media_contents');
  return { ok: Boolean(columns.produced_by), details: { producedByPresent: Boolean(columns.produced_by) } };
}
