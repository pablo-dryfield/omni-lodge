import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ALL_WEEKDAYS_LITERAL = 'ARRAY[1,2,3,4,5,6,7]::INTEGER[]';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn('shift_templates', 'repeat_on', {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    allowNull: true,
    defaultValue: qi.sequelize.literal(ALL_WEEKDAYS_LITERAL),
  });

  await qi.sequelize.query(
    `UPDATE "shift_templates" SET "repeat_on" = ${ALL_WEEKDAYS_LITERAL} WHERE "repeat_on" IS NULL;`,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn('shift_templates', 'repeat_on');
}

