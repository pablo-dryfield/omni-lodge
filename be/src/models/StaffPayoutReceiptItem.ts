import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import StaffPayoutCollectionLog from './StaffPayoutCollectionLog.js';
import StaffPayoutReceipt from './StaffPayoutReceipt.js';

@Table({
  tableName: 'staff_payout_receipt_items',
  modelName: 'StaffPayoutReceiptItem',
  timestamps: true,
  underscored: true,
})
export default class StaffPayoutReceiptItem extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => StaffPayoutReceipt)
  @AllowNull(false)
  @Column({ field: 'receipt_id', type: DataType.INTEGER })
  declare receiptId: number;

  @BelongsTo(() => StaffPayoutReceipt, { foreignKey: 'receipt_id', as: 'receipt' })
  declare receipt?: NonAttribute<StaffPayoutReceipt>;

  @ForeignKey(() => StaffPayoutCollectionLog)
  @AllowNull(true)
  @Column({ field: 'collection_log_id', type: DataType.INTEGER })
  declare collectionLogId: number | null;

  @BelongsTo(() => StaffPayoutCollectionLog, { foreignKey: 'collection_log_id', as: 'collectionLog' })
  declare collectionLog?: NonAttribute<StaffPayoutCollectionLog | null>;

  @AllowNull(false)
  @Column({ field: 'collection_log_id_snapshot', type: DataType.INTEGER })
  declare collectionLogIdSnapshot: number;

  @ForeignKey(() => FinanceTransaction)
  @AllowNull(true)
  @Column({ field: 'finance_transaction_id', type: DataType.INTEGER })
  declare financeTransactionId: number | null;

  @BelongsTo(() => FinanceTransaction, { foreignKey: 'finance_transaction_id', as: 'financeTransaction' })
  declare financeTransaction?: NonAttribute<FinanceTransaction | null>;

  @AllowNull(true)
  @Column({ field: 'finance_transaction_id_snapshot', type: DataType.INTEGER })
  declare financeTransactionIdSnapshot: number | null;

  @AllowNull(false)
  @Column(DataType.STRING(255))
  declare label: string;

  @AllowNull(false)
  @Column({ field: 'amount_minor', type: DataType.INTEGER })
  declare amountMinor: number;

  @AllowNull(false)
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;
}
