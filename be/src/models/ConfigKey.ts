import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AllowNull,
  Default,
  DataType,
} from 'sequelize-typescript';

@Table({
  tableName: 'config_keys',
  modelName: 'ConfigKey',
  timestamps: true,
})
export default class ConfigKey extends Model {
  @PrimaryKey
  @AllowNull(false)
  @Column({ type: DataType.STRING(128) })
  declare key: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(128) })
  declare label: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Default('General')
  @Column({ type: DataType.STRING(128) })
  declare category: string;

  @AllowNull(false)
  @Default('string')
  @Column({ field: 'value_type', type: DataType.STRING(32) })
  declare valueType: string;

  @AllowNull(true)
  @Column({ field: 'default_value', type: DataType.TEXT })
  declare defaultValue: string | null;

  @AllowNull(true)
  @Column({ field: 'validation_rules', type: DataType.JSONB })
  declare validationRules: Record<string, unknown> | null;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_secret', type: DataType.BOOLEAN })
  declare isSecret: boolean;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_editable', type: DataType.BOOLEAN })
  declare isEditable: boolean;

  @AllowNull(false)
  @Default('low')
  @Column({ type: DataType.STRING(16) })
  declare impact: string;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
