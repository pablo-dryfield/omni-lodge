import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import VenueCompensationTerm from './VenueCompensationTerm.js';
import Product from './Product.js';

export type VenueCompensationTicketType = 'normal' | 'cocktail' | 'brunch' | 'generic';

@Table({
  timestamps: true,
  modelName: 'VenueCompensationTermRate',
  tableName: 'venue_compensation_term_rates',
})
export default class VenueCompensationTermRate extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => VenueCompensationTerm)
  @AllowNull(false)
  @Column({ field: 'term_id', type: DataType.INTEGER })
  declare termId: number;

  @BelongsTo(() => VenueCompensationTerm, { foreignKey: 'term_id', as: 'term' })
  declare term?: VenueCompensationTerm;

  @ForeignKey(() => Product)
  @AllowNull(true)
  @Column({ field: 'product_id', type: DataType.INTEGER })
  declare productId: number | null;

  @BelongsTo(() => Product, { foreignKey: 'product_id', as: 'product' })
  declare product?: Product | null;

  @AllowNull(false)
  @Default('generic')
  @Column({ field: 'ticket_type', type: DataType.ENUM('normal', 'cocktail', 'brunch', 'generic') })
  declare ticketType: VenueCompensationTicketType;

  @AllowNull(false)
  @Column({ field: 'rate_amount', type: DataType.DECIMAL(10, 2) })
  declare rateAmount: number;

  @AllowNull(false)
  @Default('per_person')
  @Column({ field: 'rate_unit', type: DataType.ENUM('per_person', 'flat') })
  declare rateUnit: 'per_person' | 'flat';

  @AllowNull(false)
  @Column({ field: 'valid_from', type: DataType.DATEONLY })
  declare validFrom: string;

  @AllowNull(true)
  @Column({ field: 'valid_to', type: DataType.DATEONLY })
  declare validTo: string | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;
}

