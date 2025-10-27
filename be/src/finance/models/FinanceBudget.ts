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
  @Column({ field: 'period', type: DataType.STRING(7) })
  declare period: string;

  @ForeignKey(() => FinanceCategory)
  @AllowNull(false)
  @Unique('finance_budgets_period_category_unique')
  @Column({ field: 'category_id', type: DataType.INTEGER })
  declare categoryId: number;

  @BelongsTo(() => FinanceCategory, 'categoryId')
  declare category?: FinanceCategory;

  @AllowNull(false)
  @Column({ field: 'amount_minor', type: DataType.INTEGER })
  declare amountMinor: number;

  @AllowNull(false)
  @Column({ field: 'currency', type: DataType.STRING(3) })
  declare currency: string;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
