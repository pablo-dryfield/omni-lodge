import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';

@Table({
  tableName: 'review_platforms',
  modelName: 'ReviewPlatform',
  timestamps: true,
  underscored: true,
})
export default class ReviewPlatform extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  declare name: string;

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING(160))
  declare slug: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(false)
  @Default(1)
  @Column({ type: DataType.DECIMAL(10, 2) })
  declare weight: number;

  @AllowNull(true)
  @Column({ field: 'source_key', type: DataType.STRING(160) })
  declare sourceKey: string | null;

  @AllowNull(true)
  @Column({ field: 'platform_url', type: DataType.STRING(512) })
  declare platformUrl: string | null;

  @AllowNull(false)
  @Default([])
  @Column({ type: DataType.JSONB })
  declare aliases: string[];
}
