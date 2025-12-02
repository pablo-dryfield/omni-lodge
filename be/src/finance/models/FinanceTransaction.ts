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
  BelongsTo,
  Index,
} from 'sequelize-typescript';
import User from '../../models/User.js';
import FinanceAccount from './FinanceAccount.js';
import FinanceCategory from './FinanceCategory.js';
import FinanceVendor from './FinanceVendor.js';
import FinanceClient from './FinanceClient.js';
import FinanceFile from './FinanceFile.js';

export type FinanceTransactionKind = 'income' | 'expense' | 'transfer' | 'refund';
export type FinanceTransactionStatus =
  | 'planned'
  | 'approved'
  | 'awaiting_reimbursement'
  | 'paid'
  | 'reimbursed'
  | 'void';
export type FinanceTransactionCounterpartyType = 'vendor' | 'client' | 'none';

@Table({
  tableName: 'finance_transactions',
  timestamps: true,
  underscored: true,
})
export default class FinanceTransaction extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'kind', type: DataType.ENUM('income', 'expense', 'transfer', 'refund') })
  declare kind: FinanceTransactionKind;

  @AllowNull(false)
  @Column({ field: 'date', type: DataType.DATEONLY })
  declare date: string;

  @ForeignKey(() => FinanceAccount)
  @AllowNull(false)
  @Column({ field: 'account_id', type: DataType.INTEGER })
  declare accountId: number;

  @BelongsTo(() => FinanceAccount, 'accountId')
  declare account?: FinanceAccount;

  @AllowNull(false)
  @Column({ field: 'currency', type: DataType.STRING(3) })
  declare currency: string;

  @AllowNull(false)
  @Column({ field: 'amount_minor', type: DataType.INTEGER })
  declare amountMinor: number;

  @AllowNull(false)
  @Default(1)
  @Column({ field: 'fx_rate', type: DataType.DECIMAL(18, 6) })
  declare fxRate: string;

  @AllowNull(false)
  @Column({ field: 'base_amount_minor', type: DataType.INTEGER })
  declare baseAmountMinor: number;

  @ForeignKey(() => FinanceCategory)
  @AllowNull(true)
  @Column({ field: 'category_id', type: DataType.INTEGER })
  declare categoryId: number | null;

  @BelongsTo(() => FinanceCategory, 'categoryId')
  declare category?: FinanceCategory | null;

  @AllowNull(false)
  @Default('none')
  @Column({ field: 'counterparty_type', type: DataType.ENUM('vendor', 'client', 'none') })
  declare counterpartyType: FinanceTransactionCounterpartyType;

  @AllowNull(true)
  @Column({ field: 'counterparty_id', type: DataType.INTEGER })
  declare counterpartyId: number | null;

  @BelongsTo(() => FinanceVendor, {
    foreignKey: 'counterpartyId',
    constraints: false,
  })
  declare vendor?: FinanceVendor | null;

  @BelongsTo(() => FinanceClient, {
    foreignKey: 'counterpartyId',
    constraints: false,
  })
  declare client?: FinanceClient | null;

  @AllowNull(true)
  @Column({ field: 'payment_method', type: DataType.STRING(60) })
  declare paymentMethod: string | null;

  @AllowNull(false)
  @Default('planned')
  @Column({
    field: 'status',
    type: DataType.ENUM('planned', 'approved', 'awaiting_reimbursement', 'paid', 'reimbursed', 'void'),
  })
  declare status: FinanceTransactionStatus;

  @AllowNull(true)
  @Column({ field: 'description', type: DataType.TEXT })
  declare description: string | null;

  @AllowNull(true)
  @Column({ field: 'tags', type: DataType.JSONB })
  declare tags: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ field: 'meta', type: DataType.JSONB })
  declare meta: Record<string, unknown> | null;

  @ForeignKey(() => FinanceFile)
  @AllowNull(true)
  @Column({ field: 'invoice_file_id', type: DataType.INTEGER })
  declare invoiceFileId: number | null;

  @BelongsTo(() => FinanceFile, 'invoiceFileId')
  declare invoiceFile?: FinanceFile | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @BelongsTo(() => User, 'createdBy')
  declare creator?: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'approved_by', type: DataType.INTEGER })
  declare approvedBy: number | null;

  @BelongsTo(() => User, 'approvedBy')
  declare approver?: User | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

}

