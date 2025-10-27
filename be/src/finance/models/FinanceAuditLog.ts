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
  @Index('finance_audit_logs_entity_idx')
  @Column(DataType.STRING(80))
  declare entity: string;

  @AllowNull(false)
  @Index('finance_audit_logs_entity_idx')
  @Column(DataType.INTEGER)
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
  @Column(DataType.INTEGER)
  declare performedBy: number | null;

  @BelongsTo(() => User, 'performedBy')
  declare actor?: User | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare occurredAt: Date;
}

