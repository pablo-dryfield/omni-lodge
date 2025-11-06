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
import ReportDashboard from "./ReportDashboard.js";
import ReportTemplate from "./ReportTemplate.js";

@Table({
  tableName: "report_dashboard_cards",
  modelName: "ReportDashboardCard",
  timestamps: true,
  underscored: true,
})
export default class ReportDashboardCard extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => ReportDashboard)
  @AllowNull(false)
  @Column({ field: "dashboard_id", type: DataType.UUID })
  declare dashboardId: string;

  @ForeignKey(() => ReportTemplate)
  @AllowNull(false)
  @Column({ field: "template_id", type: DataType.UUID })
  declare templateId: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(160) })
  declare title: string;

  @AllowNull(false)
  @Default({})
  @Column({ field: "view_config", type: DataType.JSONB })
  declare viewConfig: Record<string, unknown>;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare layout: Record<string, unknown>;

  @BelongsTo(() => ReportDashboard, { foreignKey: "dashboardId", as: "dashboard" })
  declare dashboard?: NonAttribute<ReportDashboard>;

  @BelongsTo(() => ReportTemplate, { foreignKey: "templateId", as: "template" })
  declare template?: NonAttribute<ReportTemplate>;
}
