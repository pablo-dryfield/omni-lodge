import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import CompensationComponentAssignment from './CompensationComponentAssignment.js';

export type CompensationComponentCategory =
  | 'base'
  | 'commission'
  | 'incentive'
  | 'bonus'
  | 'review'
  | 'deduction'
  | 'adjustment';

export type CompensationCalculationMethod = 'flat' | 'per_unit' | 'tiered' | 'percentage' | 'task_score' | 'hybrid';

@Table({
  tableName: 'compensation_components',
  modelName: 'CompensationComponent',
  timestamps: true,
  underscored: true,
})
export default class CompensationComponent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(150))
  declare name: string;

  @AllowNull(false)
  @Column(DataType.STRING(180))
  declare slug: string;

  @AllowNull(false)
  @Default('base')
  @Column({ field: 'category', type: DataType.ENUM('base', 'commission', 'incentive', 'bonus', 'review', 'deduction', 'adjustment') })
  declare category: CompensationComponentCategory;

  @AllowNull(false)
  @Default('flat')
  @Column({
    field: 'calculation_method',
    type: DataType.ENUM('flat', 'per_unit', 'tiered', 'percentage', 'task_score', 'hybrid'),
  })
  declare calculationMethod: CompensationCalculationMethod;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare config: Record<string, unknown>;

  @AllowNull(false)
  @Default('PLN')
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  @HasMany(() => CompensationComponentAssignment, { foreignKey: 'component_id', as: 'assignments' })
  declare assignments?: NonAttribute<CompensationComponentAssignment[]>;
}
