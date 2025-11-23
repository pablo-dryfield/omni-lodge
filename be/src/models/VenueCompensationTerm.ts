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
import Venue from './Venue.js';
import User from './User.js';

export type VenueCompensationType = 'open_bar' | 'commission';
export type VenueCompensationDirection = 'payable' | 'receivable';
export type VenueCompensationRateUnit = 'per_person' | 'flat';

@Table({
  timestamps: true,
  modelName: 'VenueCompensationTerm',
  tableName: 'venue_compensation_terms',
})
export default class VenueCompensationTerm extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Venue)
  @AllowNull(false)
  @Column({ field: 'venue_id', type: DataType.INTEGER })
  declare venueId: number;

  @BelongsTo(() => Venue, { foreignKey: 'venue_id', as: 'venue' })
  declare venue?: Venue;

  @AllowNull(false)
  @Column({ field: 'compensation_type', type: DataType.ENUM('open_bar', 'commission') })
  declare compensationType: VenueCompensationType;

  @AllowNull(false)
  @Column({ field: 'direction', type: DataType.ENUM('payable', 'receivable') })
  declare direction: VenueCompensationDirection;

  @AllowNull(false)
  @Column({ field: 'rate_amount', type: DataType.DECIMAL(10, 2) })
  declare rateAmount: number;

  @AllowNull(false)
  @Default('per_person')
  @Column({ field: 'rate_unit', type: DataType.ENUM('per_person', 'flat') })
  declare rateUnit: VenueCompensationRateUnit;

  @AllowNull(false)
  @Default('USD')
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

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

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare notes: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: User;
}

