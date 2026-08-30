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
import User from './User.js';
import CompensationComponent from './CompensationComponent.js';
import VolunteerFund from '../finance/models/VolunteerFund.js';

export type CompensationSettlementTargetScope = 'global' | 'staff_type' | 'user';
export type CompensationSettlementMatchKind =
  | 'default'
  | 'component'
  | 'component_category'
  | 'system_source';
export type CompensationSettlementDestination = 'staff_vendor' | 'volunteer_fund' | 'excluded';

@Table({
  tableName: 'compensation_settlement_rules',
  modelName: 'CompensationSettlementRule',
  timestamps: true,
  underscored: true,
})
export default class CompensationSettlementRule extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'target_scope', type: DataType.STRING(24) })
  declare targetScope: CompensationSettlementTargetScope;

  @AllowNull(true)
  @Column({ field: 'staff_type', type: DataType.STRING(64) })
  declare staffType: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'targetUser' })
  declare targetUser?: NonAttribute<User | null>;

  @AllowNull(false)
  @Column({ field: 'match_kind', type: DataType.STRING(32) })
  declare matchKind: CompensationSettlementMatchKind;

  @ForeignKey(() => CompensationComponent)
  @AllowNull(true)
  @Column({ field: 'component_id', type: DataType.INTEGER })
  declare componentId: number | null;

  @BelongsTo(() => CompensationComponent, { foreignKey: 'component_id', as: 'component' })
  declare component?: NonAttribute<CompensationComponent | null>;

  @AllowNull(true)
  @Column({ field: 'match_key', type: DataType.STRING(180) })
  declare matchKey: string | null;

  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare destination: CompensationSettlementDestination;

  @ForeignKey(() => VolunteerFund)
  @AllowNull(true)
  @Column({ field: 'fund_id', type: DataType.INTEGER })
  declare fundId: number | null;

  @BelongsTo(() => VolunteerFund, { foreignKey: 'fund_id', as: 'fund' })
  declare fund?: NonAttribute<VolunteerFund | null>;

  @AllowNull(true)
  @Column({ field: 'effective_start', type: DataType.DATEONLY })
  declare effectiveStart: string | null;

  @AllowNull(true)
  @Column({ field: 'effective_end', type: DataType.DATEONLY })
  declare effectiveEnd: string | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  declare createdAt: Date;
  declare updatedAt: Date;
}
