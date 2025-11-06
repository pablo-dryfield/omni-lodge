import {
  Model,
  Table,
  Column,
  PrimaryKey,
  DataType,
  AllowNull,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import type { NonAttribute } from "sequelize";
import ReportTemplate from "./ReportTemplate.js";

@Table({
  tableName: "report_query_cache",
  modelName: "ReportQueryCacheEntry",
  timestamps: false,
  underscored: true,
})
export default class ReportQueryCacheEntry extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(128) })
  declare hash: string;

  @ForeignKey(() => ReportTemplate)
  @AllowNull(true)
  @Column({ field: "template_id", type: DataType.UUID })
  declare templateId: string | null;

  @AllowNull(false)
  @Column({ type: DataType.JSONB })
  declare result: unknown;

  @AllowNull(false)
  @Column({ type: DataType.JSONB })
  declare meta: Record<string, unknown>;

  @AllowNull(false)
  @Column({ field: "created_at", type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Column({ field: "expires_at", type: DataType.DATE })
  declare expiresAt: Date;

  @BelongsTo(() => ReportTemplate, { foreignKey: "templateId", as: "template" })
  declare template?: NonAttribute<ReportTemplate | null>;
}
