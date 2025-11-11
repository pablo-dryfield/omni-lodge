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
}
