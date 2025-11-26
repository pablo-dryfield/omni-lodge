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
import FinanceVendor from '../finance/models/FinanceVendor.js';
import FinanceClient from '../finance/models/FinanceClient.js';

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

  @ForeignKey(() => FinanceVendor)
  @AllowNull(true)
  @Column({ field: 'finance_vendor_id', type: DataType.INTEGER })
  declare financeVendorId: number | null;

  @BelongsTo(() => FinanceVendor, { foreignKey: 'finance_vendor_id', as: 'financeVendor' })
  declare financeVendor?: NonAttribute<FinanceVendor | null>;

  @ForeignKey(() => FinanceClient)
  @AllowNull(true)
  @Column({ field: 'finance_client_id', type: DataType.INTEGER })
  declare financeClientId: number | null;

  @BelongsTo(() => FinanceClient, { foreignKey: 'finance_client_id', as: 'financeClient' })
  declare financeClient?: NonAttribute<FinanceClient | null>;

}
