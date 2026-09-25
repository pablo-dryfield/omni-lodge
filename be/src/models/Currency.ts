import {
  AllowNull,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({
  timestamps: true,
  underscored: true,
  modelName: 'Currency',
  tableName: 'currencies',
})
export default class Currency extends Model {
  @PrimaryKey
  @Column(DataType.STRING(3))
  declare code: string;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  declare name: string;

  @AllowNull(false)
  @Default(1)
  @Column({ field: 'exchange_rate_to_pln', type: DataType.DECIMAL(12, 6) })
  declare exchangeRateToPln: number;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(true)
  @Column({ field: 'last_rate_updated_at', type: DataType.DATE })
  declare lastRateUpdatedAt: Date | null;
}
