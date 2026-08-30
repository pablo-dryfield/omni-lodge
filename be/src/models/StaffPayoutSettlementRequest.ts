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

@Table({
  tableName: 'staff_payout_settlement_requests',
  modelName: 'StaffPayoutSettlementRequest',
  timestamps: false,
  underscored: true,
})
export default class StaffPayoutSettlementRequest extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'staff_user_id', type: DataType.INTEGER })
  declare staffUserId: number;

  @BelongsTo(() => User, { foreignKey: 'staff_user_id', as: 'staffUser' })
  declare staffUser?: NonAttribute<User>;

  @AllowNull(false)
  @Column({ field: 'request_id', type: DataType.STRING(128) })
  declare requestId: string;

  @AllowNull(false)
  @Column({ field: 'payout_batch_key', type: DataType.STRING(64) })
  declare payoutBatchKey: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User>;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;
}
