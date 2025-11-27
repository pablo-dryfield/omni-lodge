import { DataTypes, QueryInterface, Sequelize } from "sequelize";

const TABLE = "staff_payout_ledgers";

export async function up(qi: QueryInterface, sequelize: typeof Sequelize): Promise<void> {
  await qi.createTable(TABLE, {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    staff_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    range_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    range_end: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    currency_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "PLN",
    },
    opening_balance_minor: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    due_amount_minor: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    paid_amount_minor: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    closing_balance_minor: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  await qi.addIndex(TABLE, ["staff_user_id", "range_start", "range_end"], {
    unique: true,
    name: "staff_payout_ledgers_user_range_unique",
  });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.dropTable(TABLE);
}
