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
import User from '../../models/User.js';
import FinanceAccount from './FinanceAccount.js';
import FinanceCategory from './FinanceCategory.js';
import VolunteerFundEntry from './VolunteerFundEntry.js';

@Table({
  tableName: 'volunteer_funds',
  modelName: 'VolunteerFund',
  timestamps: true,
  underscored: true,
})
export default class VolunteerFund extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare name: string;

  @AllowNull(false)
  @Column(DataType.STRING(180))
  declare slug: string;

  @AllowNull(false)
  @Column(DataType.STRING(3))
  declare currency: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @ForeignKey(() => FinanceAccount)
  @AllowNull(true)
  @Column({ field: 'linked_account_id', type: DataType.INTEGER })
  declare linkedAccountId: number | null;

  @BelongsTo(() => FinanceAccount, { foreignKey: 'linked_account_id', as: 'linkedAccount' })
  declare linkedAccount?: NonAttribute<FinanceAccount | null>;

  @ForeignKey(() => FinanceCategory)
  @AllowNull(true)
  @Column({ field: 'expense_category_id', type: DataType.INTEGER })
  declare expenseCategoryId: number | null;

  @BelongsTo(() => FinanceCategory, { foreignKey: 'expense_category_id', as: 'expenseCategory' })
  declare expenseCategory?: NonAttribute<FinanceCategory | null>;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  @HasMany(() => VolunteerFundEntry, { foreignKey: 'fund_id', as: 'entries' })
  declare entries?: NonAttribute<VolunteerFundEntry[]>;

  declare createdAt: Date;
  declare updatedAt: Date;
}
