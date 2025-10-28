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
} from 'sequelize-typescript';
import ScheduleWeek from './ScheduleWeek.js';

@Table({
  tableName: 'exports',
  modelName: 'Export',
  timestamps: false,
})
export default class Export extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ScheduleWeek)
  @AllowNull(false)
  @Column({ field: 'schedule_week_id', type: DataType.INTEGER })
  declare scheduleWeekId: number;

  @AllowNull(false)
  @Column({ field: 'drive_file_id', type: DataType.STRING(160) })
  declare driveFileId: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(512) })
  declare url: string;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @BelongsTo(() => ScheduleWeek, { foreignKey: 'schedule_week_id', as: 'scheduleWeek' })
  declare scheduleWeek?: ScheduleWeek | null;
}
