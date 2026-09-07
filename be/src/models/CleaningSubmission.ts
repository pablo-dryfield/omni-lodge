import { AllowNull, AutoIncrement, BelongsTo, Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import AssistantManagerTaskLog from './AssistantManagerTaskLog.js';
import ShiftAssignment from './ShiftAssignment.js';
import User from './User.js';

export type CleaningRequiredSlot = { key: string; label: string; ruleKey: string };
export type CleaningSubmissionStatus = 'awaiting_upload' | 'awaiting_review' | 'approved' | 'escalated';

@Table({ tableName: 'cleaning_submissions', modelName: 'CleaningSubmission', timestamps: true, underscored: true })
export default class CleaningSubmission extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @ForeignKey(() => AssistantManagerTaskLog) @AllowNull(false) @Column({ field: 'task_log_id', type: DataType.INTEGER }) declare taskLogId: number;
  @BelongsTo(() => AssistantManagerTaskLog, { foreignKey: 'task_log_id', as: 'taskLog' }) declare taskLog?: NonAttribute<AssistantManagerTaskLog>;
  @ForeignKey(() => ShiftAssignment) @AllowNull(true) @Column({ field: 'shift_assignment_id', type: DataType.INTEGER }) declare shiftAssignmentId: number | null;
  @ForeignKey(() => User) @AllowNull(false) @Column({ field: 'user_id', type: DataType.INTEGER }) declare userId: number;
  @AllowNull(false) @Column({ field: 'required_slots', type: DataType.JSONB }) declare requiredSlots: CleaningRequiredSlot[];
  @AllowNull(false) @Default([]) @Column({ field: 'reviewer_user_ids', type: DataType.JSONB }) declare reviewerUserIds: number[];
  @AllowNull(false) @Default({}) @Column({ field: 'schedule_snapshot', type: DataType.JSONB }) declare scheduleSnapshot: Record<string, unknown>;
  @AllowNull(false) @Default(1) @Column(DataType.INTEGER) declare revision: number;
  @AllowNull(false) @Default('awaiting_upload') @Column(DataType.STRING(24)) declare status: CleaningSubmissionStatus;
  declare createdAt: Date;
  declare updatedAt: Date;
}
