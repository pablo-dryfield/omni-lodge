import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
  HasMany,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import ScheduleWeek from './ScheduleWeek.js';
import ShiftType from './ShiftType.js';
import ShiftTemplate from './ShiftTemplate.js';
import ShiftAssignment from './ShiftAssignment.js';

export type RequiredRoleDefinition = Array<{ shiftRoleId: number | null; role: string; required: number | null }>;

@Table({
  tableName: 'shift_instances',
  modelName: 'ShiftInstance',
  timestamps: true,
})
export default class ShiftInstance extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ScheduleWeek)
  @AllowNull(false)
  @Column({ field: 'schedule_week_id', type: DataType.INTEGER })
  declare scheduleWeekId: number;

  @ForeignKey(() => ShiftType)
  @AllowNull(false)
  @Column({ field: 'shift_type_id', type: DataType.INTEGER })
  declare shiftTypeId: number;

  @ForeignKey(() => ShiftTemplate)
  @AllowNull(true)
  @Column({ field: 'shift_template_id', type: DataType.INTEGER })
  declare shiftTemplateId: number | null;

  @AllowNull(false)
  @Column({ type: DataType.DATEONLY })
  declare date: string;

  @AllowNull(false)
  @Column({ field: 'time_start', type: DataType.TIME })
  declare timeStart: string;

  @AllowNull(true)
  @Column({ field: 'time_end', type: DataType.TIME })
  declare timeEnd: string | null;

  @AllowNull(true)
  @Column({ type: DataType.INTEGER })
  declare capacity: number | null;

  @AllowNull(true)
  @Column({ field: 'required_roles', type: DataType.JSONB })
  declare requiredRoles: RequiredRoleDefinition | null;

  @AllowNull(true)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare meta: Record<string, unknown> | null;

  @BelongsTo(() => ScheduleWeek, { foreignKey: 'schedule_week_id', as: 'scheduleWeek' })
  declare scheduleWeek?: NonAttribute<ScheduleWeek | null>;

  @BelongsTo(() => ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' })
  declare shiftType?: NonAttribute<ShiftType | null>;

  @BelongsTo(() => ShiftTemplate, { foreignKey: 'shift_template_id', as: 'template' })
  declare template?: NonAttribute<ShiftTemplate | null>;

  @HasMany(() => ShiftAssignment, { foreignKey: 'shift_instance_id', as: 'assignments' })
  declare assignments?: ShiftAssignment[];
}
