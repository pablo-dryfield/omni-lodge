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
import type FinanceTransaction from './FinanceTransaction.js';

export type FinanceCategoryKind = 'income' | 'expense';

@Table({
  tableName: 'finance_categories',
  timestamps: true,
  underscored: true,
})
export default class FinanceCategory extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.ENUM('income', 'expense'))
  declare kind: FinanceCategoryKind;

  @AllowNull(false)
  @Column(DataType.STRING(160))
  declare name: string;

  @ForeignKey(() => FinanceCategory)
  @AllowNull(true)
  @Column({ field: 'parent_id', type: DataType.INTEGER })
  declare parentId: number | null;

  @BelongsTo(() => FinanceCategory, 'parentId')
  declare parent?: FinanceCategory | null;

  @HasMany(() => FinanceCategory, 'parentId')
  declare children?: FinanceCategory[];

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  declare transactions?: FinanceTransaction[];

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
