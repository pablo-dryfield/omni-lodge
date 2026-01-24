import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
} from 'sequelize-typescript';

@Table({
  tableName: 'config_seed_runs',
  modelName: 'ConfigSeedRun',
  timestamps: true,
})
export default class ConfigSeedRun extends Model {
  @PrimaryKey
  @AutoIncrement
  @AllowNull(false)
  @Column({ type: DataType.BIGINT })
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'seed_key', type: DataType.STRING(128) })
  declare seedKey: string;

  @AllowNull(false)
  @Default('auto')
  @Column({ field: 'run_type', type: DataType.STRING(16) })
  declare runType: string;

  @AllowNull(true)
  @Column({ field: 'seeded_by', type: DataType.INTEGER })
  declare seededBy: number | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'seeded_count', type: DataType.INTEGER })
  declare seededCount: number;

  @AllowNull(true)
  @Column({ field: 'seed_details', type: DataType.JSONB })
  declare seedDetails: Record<string, unknown> | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
