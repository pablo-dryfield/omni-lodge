import {
  Model,
  Table,
  Column,
  PrimaryKey,
  Default,
  DataType,
  AllowNull,
} from "sequelize-typescript";

@Table({
  tableName: "report_async_jobs",
  modelName: "ReportAsyncJob",
  timestamps: true,
  underscored: true,
})
export default class ReportAsyncJob extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @AllowNull(true)
  @Column({ type: DataType.STRING(128) })
  declare hash: string | null;

  @AllowNull(false)
  @Default("queued")
  @Column({ type: DataType.STRING(32) })
  declare status: string;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare payload: Record<string, unknown>;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  declare result: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  declare error: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ field: "started_at", type: DataType.DATE })
  declare startedAt: Date | null;

  @AllowNull(true)
  @Column({ field: "finished_at", type: DataType.DATE })
  declare finishedAt: Date | null;
}
