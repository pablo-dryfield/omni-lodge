import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

const TABLE = "review_counter_monthly_approvals";
const TABLE_USERS = "users";

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.createTable(TABLE, {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: TABLE_USERS,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    period_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    payment_approved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    payment_approved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: TABLE_USERS,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    payment_approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    incentive_approved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    incentive_approved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: TABLE_USERS,
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    incentive_approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  await qi.addConstraint(TABLE, {
    type: "unique",
    name: "review_counter_monthly_approvals_user_period_idx",
    fields: ["user_id", "period_start"],
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.dropTable(TABLE);
}
