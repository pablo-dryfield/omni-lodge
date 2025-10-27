import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  ForeignKey,
  BelongsTo,
  Unique,
} from 'sequelize-typescript';
import FinanceCategory from './FinanceCategory.js';

@Table({
  tableName: 'finance_budgets',
  timestamps: true,
  underscored: true,
})
export default class FinanceBudget extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Unique('finance_budgets_period_category_unique')
  @Column(DataType.STRING(7))
  declare period: string;

  @ForeignKey(() => FinanceCategory)
  @AllowNull(false)
  @Unique('finance_budgets_period_category_unique')
  @Column(DataType.INTEGER)
  declare categoryId: number;

  @BelongsTo(() => FinanceCategory, 'categoryId')
  declare category?: FinanceCategory;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare amountMinor: number;

  @AllowNull(false)
  @Column(DataType.STRING(3))
  declare currency: string;
}

