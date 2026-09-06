import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import ShiftAssignment from './ShiftAssignment.js';
import User from './User.js';

export const VOLUNTEER_ATTENDANCE_STATUSES = ['attended', 'late', 'absent', 'excused'] as const;
export type VolunteerAttendanceStatus = typeof VOLUNTEER_ATTENDANCE_STATUSES[number];

@Table({
  tableName: 'volunteer_shift_attendance',
  modelName: 'VolunteerShiftAttendance',
  timestamps: true,
  underscored: true,
})
export default class VolunteerShiftAttendance extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ShiftAssignment)
  @AllowNull(false)
  @Column({ field: 'shift_assignment_id', type: DataType.INTEGER })
  declare shiftAssignmentId: number;

  @AllowNull(false)
  @Column({ type: DataType.STRING(16), validate: { isIn: [VOLUNTEER_ATTENDANCE_STATUSES] } })
  declare status: VolunteerAttendanceStatus;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'recorded_by', type: DataType.INTEGER })
  declare recordedBy: number | null;

  @AllowNull(false)
  @Column({ field: 'recorded_at', type: DataType.DATE, defaultValue: DataType.NOW })
  declare recordedAt: Date;

  @BelongsTo(() => ShiftAssignment, { foreignKey: 'shift_assignment_id', as: 'shiftAssignment' })
  declare shiftAssignment?: NonAttribute<ShiftAssignment>;

  @BelongsTo(() => User, { foreignKey: 'recorded_by', as: 'recordedByUser' })
  declare recordedByUser?: NonAttribute<User | null>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
