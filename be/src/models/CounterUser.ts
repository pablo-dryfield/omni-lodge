import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, Unique, ForeignKey, BelongsTo } from 'sequelize-typescript';
import Counter from './Counter.js';
import User from './User.js';

export type CounterStaffRole = 'guide' | 'assistant_manager';

@Table({
  timestamps: true,
  modelName: 'CounterUsers',
  tableName: 'counterUsers',
})
export default class CounterUser extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Counter)
  @AllowNull(false)
  @Unique('counter_users_counter_user_unique')
  @Column({ field: 'counter_id', type: DataType.INTEGER })
  declare counterId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Unique('counter_users_counter_user_unique')
  @Column({ field: 'user_id', type: DataType.INTEGER })
  declare userId: number;

  @AllowNull(false)
  @Default('guide')
  @Column({ type: DataType.ENUM('guide', 'assistant_manager') })
  declare role: CounterStaffRole;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(true)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare createdBy: number;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare updatedBy: number | null;

  @BelongsTo(() => Counter, { foreignKey: 'counter_id', as: 'counter' })
  declare counter?: unknown;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'counterUser' })
  declare counterUser?: User;
}
