import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({ tableName: 'review_month_locks', timestamps: true, underscored: true })
export default class ReviewMonthLock extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'period_start', type: DataType.DATEONLY, unique: true })
  declare periodStart: string;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_locked', type: DataType.BOOLEAN })
  declare isLocked: boolean;

  @AllowNull(false)
  @Default([])
  @Column({ field: 'review_ids', type: DataType.JSONB })
  declare reviewIds: number[];

  @AllowNull(true)
  @Column({ field: 'locked_at', type: DataType.DATE })
  declare lockedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'locked_by', type: DataType.INTEGER })
  declare lockedBy: number | null;

  @AllowNull(true)
  @Column({ field: 'unlocked_at', type: DataType.DATE })
  declare unlockedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'unlocked_by', type: DataType.INTEGER })
  declare unlockedBy: number | null;
}
