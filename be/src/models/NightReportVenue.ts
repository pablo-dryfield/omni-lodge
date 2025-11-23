import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import type NightReport from './NightReport.js';
import Venue from './Venue.js';
import VenueCompensationTerm from './VenueCompensationTerm.js';

@Table({
  timestamps: true,
  modelName: 'NightReportVenue',
  tableName: 'night_report_venues',
})
export default class NightReportVenue extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'report_id', type: DataType.INTEGER })
  declare reportId: number;

  @AllowNull(false)
  @Column({ field: 'order_index', type: DataType.INTEGER })
  declare orderIndex: number;

  @AllowNull(false)
  @Column({ field: 'venue_name', type: DataType.STRING(255) })
  declare venueName: string;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'total_people', type: DataType.INTEGER })
  declare totalPeople: number;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'is_open_bar', type: DataType.BOOLEAN })
  declare isOpenBar: boolean;

  @ForeignKey(() => Venue)
  @AllowNull(true)
  @Column({ field: 'venue_id', type: DataType.INTEGER })
  declare venueId: number | null;

  declare venue?: Venue;

  @AllowNull(true)
  @Column({ field: 'normal_count', type: DataType.INTEGER })
  declare normalCount: number | null;

  @AllowNull(true)
  @Column({ field: 'cocktails_count', type: DataType.INTEGER })
  declare cocktailsCount: number | null;

  @AllowNull(true)
  @Column({ field: 'brunch_count', type: DataType.INTEGER })
  declare brunchCount: number | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  @ForeignKey(() => VenueCompensationTerm)
  @AllowNull(true)
  @Column({ field: 'compensation_term_id', type: DataType.INTEGER })
  declare compensationTermId: number | null;

  @BelongsTo(() => VenueCompensationTerm, { foreignKey: 'compensation_term_id', as: 'compensationTerm' })
  declare compensationTerm?: VenueCompensationTerm;

  @AllowNull(true)
  @Column({ field: 'compensation_type', type: DataType.ENUM('open_bar', 'commission') })
  declare compensationType: 'open_bar' | 'commission' | null;

  @AllowNull(true)
  @Column({ field: 'direction', type: DataType.ENUM('payable', 'receivable') })
  declare direction: 'payable' | 'receivable' | null;

  @AllowNull(true)
  @Column({ field: 'rate_applied', type: DataType.DECIMAL(10, 2) })
  declare rateApplied: number | null;

  @AllowNull(true)
  @Column({ field: 'rate_unit', type: DataType.ENUM('per_person', 'flat') })
  declare rateUnit: 'per_person' | 'flat' | null;

  @AllowNull(true)
  @Column({ field: 'payout_amount', type: DataType.DECIMAL(12, 2) })
  declare payoutAmount: number | null;

  @AllowNull(true)
  @Default('USD')
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string | null;

  declare report?: NightReport;
}
