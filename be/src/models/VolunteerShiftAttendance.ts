import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import ShiftAssignment from './ShiftAssignment.js';
import User from './User.js';
import AssistantManagerTaskLog from './AssistantManagerTaskLog.js';

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

  @ForeignKey(() => User) @AllowNull(true) @Column({ field: 'subject_user_id', type: DataType.INTEGER })
  declare subjectUserId: number | null;

  @ForeignKey(() => AssistantManagerTaskLog) @AllowNull(true) @Column({ field: 'evidence_task_log_id', type: DataType.INTEGER })
  declare evidenceTaskLogId: number | null;
  @AllowNull(true) @Column({ field: 'evidence_shift_instance_id', type: DataType.INTEGER })
  declare evidenceShiftInstanceId: number | null;
  @AllowNull(true) @Column({ field: 'evidence_shift_type_id', type: DataType.INTEGER })
  declare evidenceShiftTypeId: number | null;
  @AllowNull(true) @Column({ field: 'evidence_rule_key', type: DataType.STRING(100) })
  declare evidenceRuleKey: string | null;
  @AllowNull(true) @Column({ field: 'evidence_file_id', type: DataType.STRING(255) })
  declare evidenceFileId: string | null;
  @AllowNull(true) @Column({ field: 'check_kind', type: DataType.STRING(32) })
  declare checkKind: 'meeting_point' | 'promotion_chat' | null;
  @AllowNull(true) @Column({ field: 'expected_time', type: DataType.STRING(5) })
  declare expectedTime: string | null;
  @AllowNull(true) @Column({ field: 'late_minutes', type: DataType.INTEGER })
  declare lateMinutes: number | null;
  @AllowNull(false) @Default(1) @Column(DataType.INTEGER)
  declare revision: number;

  @BelongsTo(() => AssistantManagerTaskLog, { foreignKey: 'evidence_task_log_id', as: 'evidenceTaskLog' })
  declare evidenceTaskLog?: NonAttribute<AssistantManagerTaskLog>;

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
