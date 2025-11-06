import {
  Model,
  Table,
  Column,
  PrimaryKey,
  Default,
  DataType,
  AllowNull,
  ForeignKey,
  HasMany,
  BelongsTo,
} from "sequelize-typescript";
import type { NonAttribute } from "sequelize";
import User from "./User.js";
import ReportDashboardCard from "./ReportDashboardCard.js";

@Table({
  tableName: "report_dashboards",
  modelName: "ReportDashboard",
  timestamps: true,
  underscored: true,
})
export default class ReportDashboard extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: "owner_id", type: DataType.INTEGER })
  declare ownerId: number | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(160) })
  declare name: string;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare config: Record<string, unknown>;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare filters: Record<string, unknown>;

  @AllowNull(true)
  @Column({ field: "share_token", type: DataType.STRING(64) })
  declare shareToken: string | null;

  @AllowNull(true)
  @Column({ field: "share_expires_at", type: DataType.DATE })
  declare shareExpiresAt: Date | null;

  @HasMany(() => ReportDashboardCard, { foreignKey: "dashboardId", as: "cards" })
  declare cards?: NonAttribute<ReportDashboardCard[]>;

  @BelongsTo(() => User, { foreignKey: "ownerId", as: "owner" })
  declare owner?: NonAttribute<User | null>;
}
