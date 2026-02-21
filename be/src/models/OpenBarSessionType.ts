import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from './User.js';
import OpenBarSession from './OpenBarSession.js';

@Table({
  tableName: 'open_bar_session_types',
  modelName: 'OpenBarSessionType',
  timestamps: true,
  underscored: true,
})
export default class OpenBarSessionType extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare name: string;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare slug: string;

  @AllowNull(false)
  @Default(60)
  @Column({ field: 'default_time_limit_minutes', type: DataType.INTEGER })
  declare defaultTimeLimitMinutes: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;

  @HasMany(() => OpenBarSession, { foreignKey: 'session_type_id', as: 'sessions' })
  declare sessions?: any[];
}
