import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE = "derived_field_definitions";

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn(TABLE, "referenced_fields", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  });

  await context.addColumn(TABLE, "join_dependencies", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });

  await context.addColumn(TABLE, "model_graph_signature", {
    type: DataTypes.STRING(128),
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn(TABLE, "model_graph_signature");
  await context.removeColumn(TABLE, "join_dependencies");
  await context.removeColumn(TABLE, "referenced_fields");
}
