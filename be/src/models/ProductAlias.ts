import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import Product from './Product.js';
import User from './User.js';

export type ProductAliasMatchType = 'exact' | 'contains' | 'regex';

@Table({
  timestamps: true,
  tableName: 'product_aliases',
  modelName: 'ProductAliases',
})
export default class ProductAlias extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Product)
  @AllowNull(true)
  @Column({
    field: 'product_id',
    type: DataType.INTEGER,
  })
  declare productId: number | null;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product | null;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(255),
  })
  declare label: string;

  @AllowNull(false)
  @Column({
    field: 'normalized_label',
    type: DataType.STRING(255),
  })
  declare normalizedLabel: string;

  @AllowNull(false)
  @Default('contains')
  @Column({
    field: 'match_type',
    type: DataType.ENUM('exact', 'contains', 'regex'),
  })
  declare matchType: ProductAliasMatchType;

  @AllowNull(false)
  @Default(100)
  @Column({
    type: DataType.INTEGER,
  })
  declare priority: number;

  @AllowNull(false)
  @Default(true)
  @Column({
    type: DataType.BOOLEAN,
  })
  declare active: boolean;

  @AllowNull(false)
  @Default(0)
  @Column({
    field: 'hit_count',
    type: DataType.INTEGER,
  })
  declare hitCount: number;

  @AllowNull(true)
  @Column({
    field: 'first_seen_at',
    type: DataType.DATE,
  })
  declare firstSeenAt: Date | null;

  @AllowNull(true)
  @Column({
    field: 'last_seen_at',
    type: DataType.DATE,
  })
  declare lastSeenAt: Date | null;

  @AllowNull(true)
  @Column({
    type: DataType.STRING(64),
  })
  declare source: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({
    field: 'created_by',
    type: DataType.INTEGER,
  })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({
    field: 'updated_by',
    type: DataType.INTEGER,
  })
  declare updatedBy: number | null;
}
