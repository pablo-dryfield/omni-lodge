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
import User from './User.js';

@Table({
  tableName: 'seo_action_logs',
  modelName: 'SeoActionLog',
  timestamps: false,
})
export default class SeoActionLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'site_url', type: DataType.TEXT })
  declare siteUrl: string;

  @AllowNull(false)
  @Column({ field: 'action_type', type: DataType.STRING(64) })
  declare actionType: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare details: string | null;

  @AllowNull(true)
  @Column({ field: 'target_query', type: DataType.TEXT })
  declare targetQuery: string | null;

  @AllowNull(true)
  @Column({ field: 'target_page', type: DataType.TEXT })
  declare targetPage: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User | null;
}
