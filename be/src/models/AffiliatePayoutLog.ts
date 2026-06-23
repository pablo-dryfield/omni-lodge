import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({
  tableName: 'affiliate_payout_logs',
  timestamps: true,
  underscored: true,
})
export default class AffiliatePayoutLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'affiliate_user_id', type: DataType.INTEGER })
  declare affiliateUserId: number;

  @AllowNull(false)
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

  @AllowNull(false)
  @Column({ field: 'amount_minor', type: DataType.INTEGER })
  declare amountMinor: number;

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
  @Default([])
  @Column({ field: 'booking_ids', type: DataType.JSONB })
  declare bookingIds: number[];

  @AllowNull(true)
  @Column({ field: 'finance_transaction_id', type: DataType.INTEGER })
  declare financeTransactionId: number | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare note: string | null;

  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
