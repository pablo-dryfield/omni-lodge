import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  ForeignKey,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import FinanceCategory from './FinanceCategory.js';
import FinanceTransaction from './FinanceTransaction.js';

@Table({
  tableName: 'finance_clients',
  timestamps: true,
  underscored: true,
})
export default class FinanceClient extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(200))
  declare name: string;

  @AllowNull(true)
  @Column(DataType.STRING(64))
  declare taxId: string | null;

  @AllowNull(true)
  @Column(DataType.STRING(160))
  declare email: string | null;

  @AllowNull(true)
  @Column(DataType.STRING(40))
  declare phone: string | null;

  @ForeignKey(() => FinanceCategory)
  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare defaultCategoryId: number | null;

  @BelongsTo(() => FinanceCategory, 'defaultCategoryId')
  declare defaultCategory?: FinanceCategory | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @HasMany(() => FinanceTransaction, 'counterpartyId')
  declare transactions?: FinanceTransaction[];
}

