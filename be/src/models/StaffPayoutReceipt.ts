import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import FinanceFile from '../finance/models/FinanceFile.js';
import RequiredAction from './RequiredAction.js';
import StaffPayoutReceiptItem from './StaffPayoutReceiptItem.js';
import User from './User.js';

export type StaffPayoutReceiptStatus = 'pending' | 'completed' | 'cancelled';

@Table({
  tableName: 'staff_payout_receipts',
  modelName: 'StaffPayoutReceipt',
  timestamps: true,
  underscored: true,
})
export default class StaffPayoutReceipt extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'staff_user_id', type: DataType.INTEGER })
  declare staffUserId: number;

  @BelongsTo(() => User, { foreignKey: 'staff_user_id', as: 'staffUser' })
  declare staffUser?: NonAttribute<User>;

  @ForeignKey(() => RequiredAction)
  @AllowNull(true)
  @Column({ field: 'required_action_id', type: DataType.INTEGER })
  declare requiredActionId: number | null;

  @BelongsTo(() => RequiredAction, { foreignKey: 'required_action_id', as: 'requiredAction' })
  declare requiredAction?: NonAttribute<RequiredAction | null>;

  @AllowNull(false)
  @Column({ field: 'payout_batch_key', type: DataType.STRING(128) })
  declare payoutBatchKey: string;

  @AllowNull(false)
  @Default('pending')
  @Column(DataType.STRING(24))
  declare status: StaffPayoutReceiptStatus;

  @AllowNull(false)
  @Column({ field: 'range_start', type: DataType.DATEONLY })
  declare rangeStart: string;

  @AllowNull(false)
  @Column({ field: 'range_end', type: DataType.DATEONLY })
  declare rangeEnd: string;

  @AllowNull(false)
  @Column({ field: 'paid_date', type: DataType.DATEONLY })
  declare paidDate: string;

  @AllowNull(false)
  @Column({ field: 'paid_by_name', type: DataType.STRING(255) })
  declare paidByName: string;

  @AllowNull(false)
  @Default('v1')
  @Column({ field: 'acceptance_version', type: DataType.STRING(32) })
  declare acceptanceVersion: string;

  @AllowNull(false)
  @Column({ field: 'acceptance_text', type: DataType.TEXT })
  declare acceptanceText: string;

  @ForeignKey(() => FinanceFile)
  @AllowNull(true)
  @Column({ field: 'photo_file_id', type: DataType.INTEGER })
  declare photoFileId: number | null;

  @BelongsTo(() => FinanceFile, { foreignKey: 'photo_file_id', as: 'photoFile' })
  declare photoFile?: NonAttribute<FinanceFile | null>;

  @ForeignKey(() => FinanceFile)
  @AllowNull(true)
  @Column({ field: 'signature_file_id', type: DataType.INTEGER })
  declare signatureFileId: number | null;

  @BelongsTo(() => FinanceFile, { foreignKey: 'signature_file_id', as: 'signatureFile' })
  declare signatureFile?: NonAttribute<FinanceFile | null>;

  @AllowNull(true)
  @Column({ field: 'confirmed_at', type: DataType.DATE })
  declare confirmedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'confirmed_by', type: DataType.INTEGER })
  declare confirmedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'confirmation_ip', type: DataType.STRING(96) })
  declare confirmationIp: string | null;

  @AllowNull(true)
  @Column({ field: 'confirmation_user_agent', type: DataType.TEXT })
  declare confirmationUserAgent: string | null;

  @AllowNull(true)
  @Column({ field: 'client_acknowledged_at', type: DataType.DATE })
  declare clientAcknowledgedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'cancelled_at', type: DataType.DATE })
  declare cancelledAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'cancelled_by', type: DataType.INTEGER })
  declare cancelledBy: number | null;

  @AllowNull(true)
  @Column({ field: 'cancel_reason', type: DataType.TEXT })
  declare cancelReason: string | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @HasMany(() => StaffPayoutReceiptItem, { foreignKey: 'receipt_id', as: 'items' })
  declare items?: NonAttribute<StaffPayoutReceiptItem[]>;
}
