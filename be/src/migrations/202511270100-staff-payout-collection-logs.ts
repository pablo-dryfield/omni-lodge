import { DataTypes, QueryInterface, Sequelize } from "sequelize";

const TABLE = "staff_payout_collection_logs";

const columnDefinitions = {
  id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    primaryKey: true,
    autoIncrement: true,
  },
  staff_profile_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: "users",
      key: "id",
    },
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  },
  direction: {
    type: DataTypes.ENUM("receivable", "payable"),
    allowNull: false,
    defaultValue: "payable",
  },
  currency_code: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: "USD",
  },
  amount_minor: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  range_start: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  range_end: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  finance_transaction_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: "finance_transactions",
      key: "id",
    },
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: "users",
      key: "id",
    },
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
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
};

export async function up(qi: QueryInterface, sequelize: typeof Sequelize): Promise<void> {
  await qi.createTable(TABLE, columnDefinitions);
  await qi.addIndex(TABLE, ["staff_profile_id"]);
  await qi.addIndex(TABLE, ["range_start", "range_end"]);
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.dropTable(TABLE);
  await qi.sequelize
    .query('DROP TYPE IF EXISTS "enum_staff_payout_collection_logs_direction"')
    .catch(() => {});
}
