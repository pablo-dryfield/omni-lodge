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
import User from './User.js';

@Table({
  tableName: 'volunteer_milestone_feedback',
  modelName: 'VolunteerMilestoneFeedback',
  timestamps: true,
  underscored: true,
})
export default class VolunteerMilestoneFeedback extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'volunteer_user_id', type: DataType.INTEGER })
  declare volunteerUserId: number;

  @AllowNull(false)
  @Column({ field: 'period_start', type: DataType.DATEONLY })
  declare periodStart: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare feedback: string | null;

  @AllowNull(false)
  @Default(false)
  @Column(DataType.BOOLEAN)
  declare approved: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'approved_by', type: DataType.INTEGER })
  declare approvedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'approved_at', type: DataType.DATE })
  declare approvedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'volunteer_user_id', as: 'volunteer' })
  declare volunteer?: NonAttribute<User>;

  @BelongsTo(() => User, { foreignKey: 'approved_by', as: 'approvedByUser' })
  declare approvedByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
