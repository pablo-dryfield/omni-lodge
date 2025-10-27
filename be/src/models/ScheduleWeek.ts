import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
  HasMany,
} from 'sequelize-typescript';
import ShiftInstance from './ShiftInstance.js';
import Availability from './Availability.js';
import Export from './Export.js';

export type ScheduleWeekState = 'collecting' | 'locked' | 'assigned' | 'published';

@Table({
  tableName: 'schedule_weeks',
  modelName: 'ScheduleWeek',
  timestamps: true,
})
export default class ScheduleWeek extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER })
  declare year: number;

  @AllowNull(false)
  @Column({ field: 'iso_week', type: DataType.INTEGER })
  declare isoWeek: number;

  @AllowNull(false)
  @Default('Europe/Warsaw')
  @Column({ type: DataType.STRING(64) })
  declare tz: string;

  @AllowNull(false)
  @Default('collecting')
  @Column({ type: DataType.ENUM('collecting', 'locked', 'assigned', 'published') })
  declare state: ScheduleWeekState;

  @HasMany(() => ShiftInstance, { foreignKey: 'schedule_week_id', as: 'shiftInstances' })
  declare shiftInstances?: ShiftInstance[];

  @HasMany(() => Availability, { foreignKey: 'schedule_week_id', as: 'availabilities' })
  declare availabilities?: Availability[];

  @HasMany(() => Export, { foreignKey: 'schedule_week_id', as: 'exports' })
  declare exports?: Export[];
}
