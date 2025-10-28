import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  Default,
  BelongsTo,
} from 'sequelize-typescript';
import User from './User.js';
import ScheduleWeek from './ScheduleWeek.js';
import ShiftType from './ShiftType.js';

export type AvailabilityStatus = 'available' | 'unavailable';

@Table({
  tableName: 'availabilities',
  modelName: 'Availability',
  timestamps: true,
})
export default class Availability extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @ForeignKey(() => ScheduleWeek)
  @AllowNull(false)
  @Column({ field: 'schedule_week_id', type: DataType.INTEGER })
  declare scheduleWeekId: number;

  @AllowNull(false)
  @Column({ type: DataType.DATEONLY })
  declare day: string;

  @AllowNull(true)
  @Column({ field: 'start_time', type: DataType.TIME })
  declare startTime: string | null;

  @AllowNull(true)
  @Column({ field: 'end_time', type: DataType.TIME })
  declare endTime: string | null;

  @ForeignKey(() => ShiftType)
  @AllowNull(true)
  @Column({ field: 'shift_type_id', type: DataType.INTEGER })
  declare shiftTypeId: number | null;

  @AllowNull(false)
  @Default('available')
  @Column({ type: DataType.ENUM('available', 'unavailable') })
  declare status: AvailabilityStatus;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User | null;

  @BelongsTo(() => ScheduleWeek, { foreignKey: 'schedule_week_id', as: 'scheduleWeek' })
  declare scheduleWeek?: ScheduleWeek | null;

  @BelongsTo(() => ShiftType, { foreignKey: 'shift_type_id', as: 'preferredShiftType' })
  declare preferredShiftType?: ShiftType | null;
}
