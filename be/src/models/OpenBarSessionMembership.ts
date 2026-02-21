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
import OpenBarSession from './OpenBarSession.js';
import User from './User.js';

@Table({
  tableName: 'open_bar_session_memberships',
  modelName: 'OpenBarSessionMembership',
  timestamps: true,
  underscored: true,
})
export default class OpenBarSessionMembership extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => OpenBarSession)
  @AllowNull(false)
  @Column({ field: 'session_id', type: DataType.INTEGER })
  declare sessionId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'joined_at', type: DataType.DATE })
  declare joinedAt: Date;

  @AllowNull(true)
  @Column({ field: 'left_at', type: DataType.DATE })
  declare leftAt: Date | null;

  @BelongsTo(() => OpenBarSession, { foreignKey: 'session_id', as: 'session' })
  declare session?: any;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: any;
}
