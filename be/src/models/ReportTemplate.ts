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
import type { DerivedFieldExpressionAst } from "../types/DerivedFieldExpressionAst.js";

export type ReportTemplateFieldSelection = {
  modelId: string;
  fieldIds: string[];
};

export type PreviewOrderRule = {
  id: string;
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  direction: "asc" | "desc";
};

export type ReportTemplateOptions = {
  autoDistribution: boolean;
  notifyTeam: boolean;
  columnOrder: string[];
  columnAliases: Record<string, string>;
  previewOrder: PreviewOrderRule[];
  autoRunOnOpen: boolean;
};

export type ReportTemplateDerivedField = {
  id: string;
  name: string;
  expression: string;
  kind: "row" | "aggregate";
  scope: "template";
  metadata?: Record<string, unknown>;
  expressionAst?: DerivedFieldExpressionAst | null;
  referencedModels?: string[];
  referencedFields?: Record<string, string[]>;
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
  status?: "active" | "stale";
};

export type ReportTemplateMetricSpotlight = {
  metric: string;
  label: string;
  target?: number;
  comparison?: "previous" | "wow" | "mom" | "yoy";
  format?: "number" | "currency" | "percentage";
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
  @Default({
    autoDistribution: true,
    notifyTeam: true,
    columnOrder: [],
    columnAliases: {},
    previewOrder: [],
    autoRunOnOpen: false,
  })
  @Column({ type: DataType.JSONB })
  declare options: ReportTemplateOptions;

  @AllowNull(true)
  @Column({ field: 'query_config', type: DataType.JSONB })
  declare queryConfig: unknown | null;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'derived_fields', type: DataType.JSONB })
  declare derivedFields: ReportTemplateDerivedField[];

  @AllowNull(false)
  @Default([])
  @Column({ field: 'metrics_spotlight', type: DataType.JSONB })
  declare metricsSpotlight: ReportTemplateMetricSpotlight[];

  @AllowNull(false)
  @Default([])
  @Column({ field: 'preview_order', type: DataType.JSONB })
  declare previewOrder: PreviewOrderRule[];

  @BelongsTo(() => User, { foreignKey: 'userId', as: 'owner' })
  declare owner?: NonAttribute<User | null>;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
