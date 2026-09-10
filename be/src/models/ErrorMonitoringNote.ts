import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';

import User from './User.js';
import ErrorMonitoringIssue from './ErrorMonitoringIssue.js';

@Table({
  tableName: 'error_monitoring_notes',
  modelName: 'ErrorMonitoringNote',
  timestamps: false,
})
export default class ErrorMonitoringNote extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  declare id: number;

  @ForeignKey(() => ErrorMonitoringIssue)
  @AllowNull(false)
  @Column({ field: 'issue_id', type: DataType.BIGINT })
  declare issueId: number;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'author_user_id', type: DataType.INTEGER })
  declare authorUserId: number | null;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare body: string;

  @AllowNull(false)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(false)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;

  @BelongsTo(() => ErrorMonitoringIssue, { foreignKey: 'issueId', as: 'issue' })
  declare issue?: NonAttribute<ErrorMonitoringIssue>;

  @BelongsTo(() => User, { foreignKey: 'authorUserId', as: 'author' })
  declare author?: NonAttribute<User | null>;
}
