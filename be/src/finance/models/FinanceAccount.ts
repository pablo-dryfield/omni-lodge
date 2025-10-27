import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  HasMany,
  Index,
} from 'sequelize-typescript';
import FinanceTransaction from './FinanceTransaction.js';

export type FinanceAccountType = 'cash' | 'bank' | 'stripe' | 'revolut' | 'other';

@Table({
  tableName: 'finance_accounts',
  timestamps: true,
  underscored: true,
})
export default class FinanceAccount extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Index('finance_accounts_name_unique')
  @Column(DataType.STRING(120))
  declare name: string;

  @AllowNull(false)
  @Column(
    DataType.ENUM('cash', 'bank', 'stripe', 'revolut', 'other'),
  )
  declare type: FinanceAccountType;

  @AllowNull(false)
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(false)
  @Default(0)
  @Column(DataType.INTEGER)
  declare openingBalanceMinor: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @HasMany(() => FinanceTransaction, 'accountId')
  declare transactions?: FinanceTransaction[];
}

