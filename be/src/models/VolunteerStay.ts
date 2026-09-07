import {
  AllowNull, AutoIncrement, BelongsTo, Column, CreatedAt, DataType, Default,
  ForeignKey, Model, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';

export type VolunteerStayPosition = 'guide' | 'social_media';
export type VolunteerStayMonthlyTargets = {
  reviews: number;
  guidingShifts: number;
  promotionShifts: number;
  socialMediaShifts: number;
  cleaningTasks: number;
  attendancePercent: number;
};
export type VolunteerStayShiftTypeIds = {
  guiding: number[];
  promotion: number[];
  socialMedia: number[];
};
export type VolunteerStayFeedback = {
  approved: boolean;
  feedback: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  updatedBy: number | null;
  updatedAt: string;
};

/** A manager-confirmed, versioned agreement; profile edits never rewrite this stay. */
@Table({ tableName: 'volunteer_stays', modelName: 'VolunteerStay', timestamps: true, underscored: true })
export default class VolunteerStay extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User) @AllowNull(false) @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false) @Column({ field: 'start_date', type: DataType.DATEONLY })
  declare startDate: string;

  /** Exclusive departure boundary, matching target and source-evidence date ranges. */
  @AllowNull(false) @Column({ field: 'end_date', type: DataType.DATEONLY })
  declare endDate: string;

  @AllowNull(false) @Column(DataType.STRING(24))
  declare position: VolunteerStayPosition;

  @AllowNull(false) @Column({ field: 'monthly_targets', type: DataType.JSONB })
  declare monthlyTargets: VolunteerStayMonthlyTargets;

  @AllowNull(false) @Column({ field: 'shift_type_ids', type: DataType.JSONB })
  declare shiftTypeIds: VolunteerStayShiftTypeIds;

  @AllowNull(true) @Column(DataType.JSONB)
  declare feedback: VolunteerStayFeedback | null;

  @AllowNull(true) @Column({ field: 'change_reason', type: DataType.TEXT })
  declare changeReason: string | null;

  @AllowNull(false) @Default(1) @Column(DataType.INTEGER)
  declare revision: number;

  @ForeignKey(() => User) @AllowNull(true) @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User) @AllowNull(true) @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User>;

  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
