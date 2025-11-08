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
import User from "./User.js";
import type { DerivedFieldExpressionAst } from "../types/DerivedFieldExpressionAst.js";

@Table({
  tableName: "derived_field_definitions",
  modelName: "DerivedFieldDefinition",
  timestamps: true,
  underscored: true,
})
export default class DerivedFieldDefinition extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID })
  declare id: string;

  @AllowNull(false)
  @Default("workspace")
  @Column({ type: DataType.STRING(32) })
  declare scope: "workspace" | "template";

  @AllowNull(true)
  @Column({ field: "workspace_id", type: DataType.INTEGER })
  declare workspaceId: number | null;

  @ForeignKey(() => ReportTemplate)
  @AllowNull(true)
  @Column({ field: "template_id", type: DataType.UUID })
  declare templateId: string | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(160) })
  declare name: string;

  @AllowNull(false)
  @Column({ type: DataType.TEXT })
  declare expression: string;

  @AllowNull(false)
  @Default("row")
  @Column({ type: DataType.STRING(32) })
  declare kind: "row" | "aggregate";

  @AllowNull(true)
  @Column({ field: "expression_ast", type: DataType.JSONB })
  declare expressionAst: DerivedFieldExpressionAst | null;

  @AllowNull(false)
  @Default([])
  @Column({ field: "referenced_models", type: DataType.JSONB })
  declare referencedModels: string[];

  @AllowNull(false)
  @Default({})
  @Column({ field: "referenced_fields", type: DataType.JSONB })
  declare referencedFields: Record<string, string[]>;

  @AllowNull(false)
  @Default([])
  @Column({ field: "join_dependencies", type: DataType.JSONB })
  declare joinDependencies: Array<[string, string]>;

  @AllowNull(true)
  @Column({ field: "model_graph_signature", type: DataType.STRING(128) })
  declare modelGraphSignature: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare metadata: Record<string, unknown>;

  @AllowNull(true)
  @Column({ field: "compiled_expression_hash", type: DataType.STRING(128) })
  declare compiledExpressionHash: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: "created_by", type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => ReportTemplate, { foreignKey: "templateId", as: "template" })
  declare template?: NonAttribute<ReportTemplate | null>;

  @BelongsTo(() => User, { foreignKey: "createdBy", as: "creator" })
  declare creator?: NonAttribute<User | null>;
}
