import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE = "derived_field_definitions";

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn(TABLE, "expression_ast", {
    type: DataTypes.JSONB,
    allowNull: true,
  });

  await context.addColumn(TABLE, "referenced_models", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn(TABLE, "expression_ast");
  await context.removeColumn(TABLE, "referenced_models");
}
