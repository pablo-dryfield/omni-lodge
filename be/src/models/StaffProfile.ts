import {
  Model,
  Table,
  Column,
  ForeignKey,
  PrimaryKey,
  AllowNull,
  DataType,
  Default,
  BelongsTo,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';

export type StaffType = 'volunteer' | 'long_term' | 'assistant_manager' | 'manager' | 'guide';

@Table({
  tableName: 'staff_profiles',
  modelName: 'StaffProfile',
  timestamps: true,
})
export default class StaffProfile extends Model {
  @PrimaryKey
  @ForeignKey(() => User)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Column({
    field: 'staff_type',
    type: DataType.ENUM('volunteer', 'long_term', 'assistant_manager', 'manager', 'guide'),
  })
  declare staffType: StaffType;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'lives_in_accom', type: DataType.BOOLEAN })
  declare livesInAccom: boolean;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'active', type: DataType.BOOLEAN })
  declare active: boolean;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;
}
