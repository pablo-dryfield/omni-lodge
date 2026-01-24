import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AllowNull,
  Default,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import ConfigKey from './ConfigKey.js';
import User from './User.js';

@Table({
  tableName: 'config_values',
  modelName: 'ConfigValue',
  timestamps: true,
})
export default class ConfigValue extends Model {
  @PrimaryKey
  @ForeignKey(() => ConfigKey)
  @AllowNull(false)
  @Column({ type: DataType.STRING(128) })
  declare key: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare value: string | null;

  @AllowNull(true)
  @Column({ field: 'encrypted_value', type: DataType.TEXT })
  declare encryptedValue: string | null;

  @AllowNull(true)
  @Column({ field: 'encryption_iv', type: DataType.STRING(64) })
  declare encryptionIv: string | null;

  @AllowNull(true)
  @Column({ field: 'encryption_tag', type: DataType.STRING(64) })
  declare encryptionTag: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;

  @BelongsTo(() => ConfigKey, { foreignKey: 'key', as: 'configKey' })
  declare configKey?: ConfigKey;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User | null;
}
