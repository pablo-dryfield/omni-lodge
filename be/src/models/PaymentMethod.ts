import {
  Table,
  Model,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
  HasMany,
} from 'sequelize-typescript';
import Channel from './Channel.js';

@Table({
  timestamps: true,
  modelName: 'PaymentMethod',
  tableName: 'payment_methods',
})
export default class PaymentMethod extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare name: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare description: string | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updatedAt: Date;

  @HasMany(() => Channel, { foreignKey: 'paymentMethodId', as: 'channels' })
  declare channels?: Channel[];
}
