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
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import AssistantManagerTaskAssignment from './AssistantManagerTaskAssignment.js';
import AssistantManagerTaskLog from './AssistantManagerTaskLog.js';

export type AssistantManagerTaskCadence = 'daily' | 'weekly' | 'biweekly' | 'every_two_weeks' | 'monthly';

@Table({
  tableName: 'am_task_templates',
  modelName: 'AssistantManagerTaskTemplate',
  timestamps: true,
  underscored: true,
})
export default class AssistantManagerTaskTemplate extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare name: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Default('daily')
  @Column({
    type: DataType.ENUM('daily', 'weekly', 'biweekly', 'every_two_weeks', 'monthly'),
  })
  declare cadence: AssistantManagerTaskCadence;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'schedule_config', type: DataType.JSONB })
  declare scheduleConfig: Record<string, unknown>;

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
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  @HasMany(() => AssistantManagerTaskAssignment, { foreignKey: 'template_id', as: 'assignments' })
  declare assignments?: NonAttribute<AssistantManagerTaskAssignment[]>;

  @HasMany(() => AssistantManagerTaskLog, { foreignKey: 'template_id', as: 'logs' })
  declare logs?: NonAttribute<AssistantManagerTaskLog[]>;
}
