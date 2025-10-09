import { Model, Table, Column, PrimaryKey, AutoIncrement, AllowNull, Default, DataType, ForeignKey, BelongsTo, HasMany, Unique } from 'sequelize-typescript';
import User from './User.js';
import Product from './Product.js';
import CounterChannelMetric from './CounterChannelMetric.js';
import CounterUser from './CounterUser.js';
import CounterProduct from './CounterProduct.js';

export type CounterStatus = 'draft' | 'platforms' | 'reservations' | 'final';

@Table({
  timestamps: true,
  modelName: 'Counters',
  tableName: 'counters'
})
export default class Counter extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Unique('counter_date_unique')
  @Column(DataType.DATEONLY)
  declare date: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare userId: number;

  @ForeignKey(() => Product)
  @AllowNull(true)
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number | null;

  @AllowNull(false)
  @Default('draft')
  @Column({ type: DataType.ENUM('draft', 'platforms', 'reservations', 'final') })
  declare status: CounterStatus;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

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

  @BelongsTo(() => User, { foreignKey: 'userId', as: 'manager' })
  declare manager?: User;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product | null;

  @HasMany(() => CounterChannelMetric, { foreignKey: 'counter_id', as: 'metrics' })
  declare metrics?: CounterChannelMetric[];

  @HasMany(() => CounterUser, { foreignKey: 'counter_id', as: 'staff' })
  declare staff?: CounterUser[];

  @HasMany(() => CounterProduct, { foreignKey: 'counterId', as: 'products' })
  declare products?: CounterProduct[];
}







