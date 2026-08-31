import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import ShiftRole from './ShiftRole.js';
import User from './User.js';
import UserType from './UserType.js';

export type HomeQuickActionTargetEffect = 'allow' | 'deny';

@Table({
  tableName: 'home_quick_action_targets',
  modelName: 'HomeQuickActionTarget',
  timestamps: true,
  underscored: true,
})
export default class HomeQuickActionTarget extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'action_key', type: DataType.STRING(120) })
  declare actionKey: string;

  @AllowNull(false)
  @Default('allow')
  @Column(DataType.STRING(16))
  declare effect: HomeQuickActionTargetEffect;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @ForeignKey(() => UserType)
  @AllowNull(true)
  @Column({ field: 'user_type_id', type: DataType.INTEGER })
  declare userTypeId: number | null;

  @ForeignKey(() => ShiftRole)
  @AllowNull(true)
  @Column({ field: 'shift_role_id', type: DataType.INTEGER })
  declare shiftRoleId: number | null;

  @AllowNull(true)
  @Column({ field: 'staff_profile_type', type: DataType.STRING(64) })
  declare staffProfileType: string | null;
}
