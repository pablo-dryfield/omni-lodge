import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import User from './User.js';

@Table({
  tableName: 'audit_logs',
  modelName: 'AuditLog',
  timestamps: false,
})
export default class AuditLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'actor_id', type: DataType.INTEGER })
  declare actorId: number | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(120) })
  declare action: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(120) })
  declare entity: string;

  @AllowNull(false)
  @Column({ field: 'entity_id', type: DataType.STRING(64) })
  declare entityId: string;

  @AllowNull(true)
  @Column({ field: 'meta_json', type: DataType.JSONB })
  declare metaJson: Record<string, unknown> | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @BelongsTo(() => User, { foreignKey: 'actor_id', as: 'actor' })
  declare actor?: User | null;
}
