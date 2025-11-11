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
import User from './User.js';

export type AssistantManagerTaskAssignmentScope = 'staff_type' | 'user';

@Table({
  tableName: 'am_task_assignments',
  modelName: 'AssistantManagerTaskAssignment',
  timestamps: true,
  underscored: true,
})
export default class AssistantManagerTaskAssignment extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => AssistantManagerTaskTemplate)
  @AllowNull(false)
  @Column({ field: 'template_id', type: DataType.INTEGER })
  declare templateId: number;

  @AllowNull(false)
  @Default('staff_type')
  @Column({ field: 'target_scope', type: DataType.ENUM('staff_type', 'user') })
  declare targetScope: AssistantManagerTaskAssignmentScope;

  @AllowNull(true)
  @Column({ field: 'staff_type', type: DataType.STRING(64) })
  declare staffType: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @AllowNull(true)
  @Column({ field: 'effective_start', type: DataType.DATEONLY })
  declare effectiveStart: string | null;

  @AllowNull(true)
  @Column({ field: 'effective_end', type: DataType.DATEONLY })
  declare effectiveEnd: string | null;

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

  @BelongsTo(() => AssistantManagerTaskTemplate, { foreignKey: 'template_id', as: 'template' })
  declare template?: NonAttribute<AssistantManagerTaskTemplate>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;
}
