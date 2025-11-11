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
import type { NonAttribute } from 'sequelize';
import AssistantManagerTaskTemplate from './AssistantManagerTaskTemplate.js';
import AssistantManagerTaskAssignment from './AssistantManagerTaskAssignment.js';
import User from './User.js';

export type AssistantManagerTaskStatus = 'pending' | 'completed' | 'missed' | 'waived';

@Table({
  tableName: 'am_task_logs',
  modelName: 'AssistantManagerTaskLog',
  timestamps: true,
  underscored: true,
})
export default class AssistantManagerTaskLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => AssistantManagerTaskTemplate)
  @AllowNull(false)
  @Column({ field: 'template_id', type: DataType.INTEGER })
  declare templateId: number;

  @ForeignKey(() => AssistantManagerTaskAssignment)
  @AllowNull(true)
  @Column({ field: 'assignment_id', type: DataType.INTEGER })
  declare assignmentId: number | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Column({ field: 'task_date', type: DataType.DATEONLY })
  declare taskDate: string;

  @AllowNull(false)
  @Default('pending')
  @Column({ type: DataType.ENUM('pending', 'completed', 'missed', 'waived') })
  declare status: AssistantManagerTaskStatus;

  @AllowNull(true)
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare meta: Record<string, unknown>;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => AssistantManagerTaskTemplate, { foreignKey: 'template_id', as: 'template' })
  declare template?: NonAttribute<AssistantManagerTaskTemplate>;

  @BelongsTo(() => AssistantManagerTaskAssignment, { foreignKey: 'assignment_id', as: 'assignment' })
  declare assignment?: NonAttribute<AssistantManagerTaskAssignment | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User>;
}
