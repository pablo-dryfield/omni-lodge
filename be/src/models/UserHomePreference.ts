import {
  Model,
  Table,
  Column,
  PrimaryKey,
  Default,
  DataType,
  AllowNull,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import type { NonAttribute } from "sequelize";
import User from "./User.js";

export type HomeViewMode = "navigation" | "dashboard";

@Table({
  tableName: "user_home_preferences",
  modelName: "UserHomePreference",
  timestamps: true,
  underscored: true,
})
export default class UserHomePreference extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: "user_id", type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default("navigation")
  @Column({ field: "view_mode", type: DataType.STRING(32) })
  declare viewMode: HomeViewMode;

  @AllowNull(false)
  @Default([])
  @Column({ field: "saved_dashboard_ids", type: DataType.JSONB })
  declare savedDashboardIds: string[];

  @AllowNull(true)
  @Column({ field: "active_dashboard_id", type: DataType.UUID })
  declare activeDashboardId: string | null;

  @BelongsTo(() => User, { foreignKey: "userId", as: "user" })
  declare user?: NonAttribute<User>;
}
