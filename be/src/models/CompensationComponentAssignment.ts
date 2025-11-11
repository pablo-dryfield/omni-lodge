import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import CompensationComponent from './CompensationComponent.js';
import ShiftRole from './ShiftRole.js';
import User from './User.js';
import UserType from './UserType.js';

export type CompensationTargetScope = 'global' | 'shift_role' | 'user' | 'user_type' | 'staff_type';

@Table({
  tableName: 'compensation_component_assignments',
  modelName: 'CompensationComponentAssignment',
  timestamps: true,
  underscored: true,
})
export default class CompensationComponentAssignment extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => CompensationComponent)
  @AllowNull(false)
  @Column({ field: 'component_id', type: DataType.INTEGER })
  declare componentId: number;

  @AllowNull(false)
  @Default('global')
  @Column({ field: 'target_scope', type: DataType.ENUM('global', 'shift_role', 'user', 'user_type', 'staff_type') })
  declare targetScope: CompensationTargetScope;

  @ForeignKey(() => ShiftRole)
  @AllowNull(true)
  @Column({ field: 'shift_role_id', type: DataType.INTEGER })
  declare shiftRoleId: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @ForeignKey(() => UserType)
  @AllowNull(true)
  @Column({ field: 'user_type_id', type: DataType.INTEGER })
  declare userTypeId: number | null;

  @AllowNull(true)
  @Column({ field: 'staff_type', type: DataType.STRING(64) })
  declare staffType: string | null;

  @AllowNull(true)
  @Column({ field: 'effective_start', type: DataType.DATEONLY })
  declare effectiveStart: string | null;

  @AllowNull(true)
  @Column({ field: 'effective_end', type: DataType.DATEONLY })
  declare effectiveEnd: string | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'base_amount', type: DataType.DECIMAL(12, 2) })
  declare baseAmount: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'unit_amount', type: DataType.DECIMAL(12, 4) })
  declare unitAmount: number;

  @AllowNull(true)
  @Column({ field: 'unit_label', type: DataType.STRING(32) })
  declare unitLabel: string | null;

  @AllowNull(false)
  @Default('PLN')
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'task_list', type: DataType.JSONB })
  declare taskList: Array<Record<string, unknown>>;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare config: Record<string, unknown>;

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

  @BelongsTo(() => CompensationComponent, { foreignKey: 'component_id', as: 'component' })
  declare component?: NonAttribute<CompensationComponent>;

  @BelongsTo(() => ShiftRole, { foreignKey: 'shift_role_id', as: 'shiftRole' })
  declare shiftRole?: NonAttribute<ShiftRole | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;

  @BelongsTo(() => UserType, { foreignKey: 'user_type_id', as: 'userType' })
  declare userType?: NonAttribute<UserType | null>;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;
}
