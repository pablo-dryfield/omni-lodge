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
import UserType from './UserType.js';

@Table({
  tableName: 'user_type_membership_periods',
  modelName: 'UserTypeMembershipPeriod',
  timestamps: true,
  underscored: true,
})
export default class UserTypeMembershipPeriod extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @ForeignKey(() => UserType)
  @AllowNull(false)
  @Column({ field: 'user_type_id', type: DataType.INTEGER })
  declare userTypeId: number;

  @AllowNull(false)
  @Column({ field: 'effective_start', type: DataType.DATEONLY })
  declare effectiveStart: string;

  @AllowNull(true)
  @Column({ field: 'effective_end', type: DataType.DATEONLY })
  declare effectiveEnd: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'ended_by', type: DataType.INTEGER })
  declare endedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'change_reason', type: DataType.TEXT })
  declare changeReason: string | null;

  @AllowNull(false)
  @Default('application')
  @Column(DataType.STRING(64))
  declare source: string;

  @AllowNull(false)
  @Default({})
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User>;

  @BelongsTo(() => UserType, { foreignKey: 'user_type_id', as: 'userType' })
  declare userType?: NonAttribute<UserType>;
}
