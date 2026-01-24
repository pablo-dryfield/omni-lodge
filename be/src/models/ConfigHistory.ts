import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import ConfigKey from './ConfigKey.js';
import User from './User.js';

@Table({
  tableName: 'config_history',
  modelName: 'ConfigHistory',
  timestamps: false,
})
export default class ConfigHistory extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => ConfigKey)
  @AllowNull(false)
  @Column({ type: DataType.STRING(128) })
  declare key: string;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'actor_id', type: DataType.INTEGER })
  declare actorId: number | null;

  @AllowNull(true)
  @Column({ field: 'old_value', type: DataType.TEXT })
  declare oldValue: string | null;

  @AllowNull(true)
  @Column({ field: 'new_value', type: DataType.TEXT })
  declare newValue: string | null;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_secret', type: DataType.BOOLEAN })
  declare isSecret: boolean;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare reason: string | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @BelongsTo(() => ConfigKey, { foreignKey: 'key', as: 'configKey' })
  declare configKey?: ConfigKey;

  @BelongsTo(() => User, { foreignKey: 'actor_id', as: 'actor' })
  declare actor?: User | null;
}
