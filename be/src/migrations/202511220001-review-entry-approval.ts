import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_REVIEW_COUNTER_ENTRIES = "review_counter_entries";
const TABLE_USERS = "users";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_REVIEW_COUNTER_ENTRIES, "under_minimum_approved", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });

  await qi.addColumn(TABLE_REVIEW_COUNTER_ENTRIES, "under_minimum_approved_by", {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: TABLE_USERS,
      key: "id",
    },
    onUpdate: "CASCADE",
    onDelete: "SET NULL",
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_REVIEW_COUNTER_ENTRIES, "under_minimum_approved_by");
  await qi.removeColumn(TABLE_REVIEW_COUNTER_ENTRIES, "under_minimum_approved");
}
