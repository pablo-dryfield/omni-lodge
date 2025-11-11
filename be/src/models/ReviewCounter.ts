import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';
import ReviewCounterEntry from './ReviewCounterEntry.js';

@Table({
  tableName: 'review_counters',
  modelName: 'ReviewCounter',
  timestamps: true,
  underscored: true,
})
export default class ReviewCounter extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(64))
  declare platform: string;

  @AllowNull(false)
  @Column({ field: 'period_start', type: DataType.DATEONLY })
  declare periodStart: string;

  @AllowNull(true)
  @Column({ field: 'period_end', type: DataType.DATEONLY })
  declare periodEnd: string | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'total_reviews', type: DataType.INTEGER })
  declare totalReviews: number;

  @AllowNull(true)
  @Column({ field: 'first_review_author', type: DataType.STRING(255) })
  declare firstReviewAuthor: string | null;

  @AllowNull(true)
  @Column({ field: 'second_review_author', type: DataType.STRING(255) })
  declare secondReviewAuthor: string | null;

  @AllowNull(true)
  @Column({ field: 'before_last_review_author', type: DataType.STRING(255) })
  declare beforeLastReviewAuthor: string | null;

  @AllowNull(true)
  @Column({ field: 'last_review_author', type: DataType.STRING(255) })
  declare lastReviewAuthor: string | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'bad_review_count', type: DataType.INTEGER })
  declare badReviewCount: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'no_name_review_count', type: DataType.INTEGER })
  declare noNameReviewCount: number;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare notes: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ type: DataType.JSONB })
  declare meta: Record<string, unknown>;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  @HasMany(() => ReviewCounterEntry, { foreignKey: 'counter_id', as: 'entries', onDelete: 'CASCADE', hooks: true })
  declare entries?: NonAttribute<ReviewCounterEntry[]>;
}
