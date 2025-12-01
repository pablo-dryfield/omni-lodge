import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

const TABLE = "review_counter_monthly_approvals";
const USERS_TABLE = "users";

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE, "base_override_approved", {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });

  await qi.addColumn(TABLE, "base_override_approved_by", {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: USERS_TABLE,
      key: "id",
    },
    onUpdate: "CASCADE",
    onDelete: "SET NULL",
  });

  await qi.addColumn(TABLE, "base_override_approved_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.removeColumn(TABLE, "base_override_approved_at");
  await qi.removeColumn(TABLE, "base_override_approved_by");
  await qi.removeColumn(TABLE, "base_override_approved");
}

