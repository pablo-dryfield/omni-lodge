import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  ForeignKey,
  Index,
} from 'sequelize-typescript';
import Currency from '../../models/Currency.js';
import type FinanceTransaction from './FinanceTransaction.js';

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

  @ForeignKey(() => Currency)
  @AllowNull(false)
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(true)
  @Column({ field: 'account_holder_name', type: DataType.STRING(160) })
  declare accountHolderName: string | null;

  @AllowNull(true)
  @Column({ field: 'account_number', type: DataType.STRING(80) })
  declare accountNumber: string | null;

  @AllowNull(true)
  @Column({ field: 'swift_code', type: DataType.STRING(32) })
  declare swiftCode: string | null;

  @AllowNull(true)
  @Column({ field: 'bank_name', type: DataType.STRING(160) })
  declare bankName: string | null;

  @AllowNull(true)
  @Column({ field: 'bank_transfer_instructions', type: DataType.TEXT })
  declare bankTransferInstructions: string | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'opening_balance_minor', type: DataType.INTEGER })
  declare openingBalanceMinor: number;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  declare transactions?: FinanceTransaction[];

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
