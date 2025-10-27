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
} from 'sequelize-typescript';
import User from '../../models/User.js';

@Table({
  tableName: 'finance_audit_logs',
  timestamps: false,
  underscored: true,
})
export default class FinanceAuditLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'entity', type: DataType.STRING(80) })
  declare entity: string;

  @AllowNull(false)
  @Column({ field: 'entity_id', type: DataType.INTEGER })
  declare entityId: number;

  @AllowNull(false)
  @Column(DataType.STRING(40))
  declare action: string;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare changes: Record<string, unknown> | null;

  @AllowNull(true)
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown> | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'performed_by', type: DataType.INTEGER })
  declare performedBy: number | null;

  @BelongsTo(() => User, 'performedBy')
  declare actor?: User | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'occurred_at', type: DataType.DATE })
  declare occurredAt: Date;
}
