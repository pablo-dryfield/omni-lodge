import { AllowNull, AutoIncrement, BelongsTo, Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import ReviewCounter from './ReviewCounter.js';
import User from './User.js';

export type ReviewCounterEntryCategory = 'staff' | 'bad' | 'no_name' | 'other';

@Table({
  tableName: 'review_counter_entries',
  modelName: 'ReviewCounterEntry',
  timestamps: true,
  underscored: true,
})
export default class ReviewCounterEntry extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => ReviewCounter)
  @AllowNull(false)
  @Column({ field: 'counter_id', type: DataType.INTEGER })
  declare counterId: number;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number | null;

  @AllowNull(false)
  @Column({ field: 'display_name', type: DataType.STRING(255) })
  declare displayName: string;

  @AllowNull(false)
  @Default('staff')
  @Column({ type: DataType.ENUM('staff', 'bad', 'no_name', 'other') })
  declare category: ReviewCounterEntryCategory;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'raw_count', type: DataType.DECIMAL(10, 2) })
  declare rawCount: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'rounded_count', type: DataType.INTEGER })
  declare roundedCount: number;

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

  @BelongsTo(() => ReviewCounter, { foreignKey: 'counter_id', as: 'counter' })
  declare counter?: NonAttribute<ReviewCounter | null>;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;
}
