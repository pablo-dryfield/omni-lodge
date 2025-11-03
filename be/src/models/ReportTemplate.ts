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
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';

export type ReportTemplateFieldSelection = {
  modelId: string;
  fieldIds: string[];
};

export type ReportTemplateOptions = {
  autoDistribution: boolean;
  notifyTeam: boolean;
};

@Table({
  tableName: 'report_templates',
  modelName: 'ReportTemplate',
  timestamps: true,
  underscored: true,
})
export default class ReportTemplate extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(160) })
  declare name: string;

  @AllowNull(true)
  @Column({ type: DataType.STRING(120) })
  declare category: string | null;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare description: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(120) })
  declare schedule: string | null;

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare models: string[];

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare fields: ReportTemplateFieldSelection[];

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare joins: unknown[];

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare visuals: unknown[];

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare metrics: string[];

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare filters: unknown[];

  @AllowNull(false)
  @Default({ autoDistribution: true, notifyTeam: true })
  @Column({ type: DataType.JSONB })
  declare options: ReportTemplateOptions;

  @BelongsTo(() => User, { foreignKey: 'userId', as: 'owner' })
  declare owner?: NonAttribute<User | null>;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
