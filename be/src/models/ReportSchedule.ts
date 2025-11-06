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
import ReportTemplate from "./ReportTemplate.js";

@Table({
  tableName: "report_schedules",
  modelName: "ReportSchedule",
  timestamps: true,
  underscored: true,
})
export default class ReportSchedule extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => ReportTemplate)
  @AllowNull(false)
  @Column({ field: "template_id", type: DataType.UUID })
  declare templateId: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(120) })
  declare cadence: string;

  @AllowNull(false)
  @Default("UTC")
  @Column({ type: DataType.STRING(64) })
  declare timezone: string;

  @AllowNull(false)
  @Default([])
  @Column({ field: "delivery_targets", type: DataType.JSONB })
  declare deliveryTargets: Array<Record<string, unknown>>;

  @AllowNull(true)
  @Column({ field: "last_run_at", type: DataType.DATE })
  declare lastRunAt: Date | null;

  @AllowNull(true)
  @Column({ field: "next_run_at", type: DataType.DATE })
  declare nextRunAt: Date | null;

  @AllowNull(false)
  @Default("active")
  @Column({ type: DataType.STRING(32) })
  declare status: string;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare meta: Record<string, unknown>;

  @BelongsTo(() => ReportTemplate, { foreignKey: "templateId", as: "template" })
  declare template?: NonAttribute<ReportTemplate>;
}
