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
import type VenueCompensationTerm from './VenueCompensationTerm.js';
import type NightReportVenue from './NightReportVenue.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import FinanceClient from '../finance/models/FinanceClient.js';

@Table({
  timestamps: true,
  tableName: 'venues',
  modelName: 'Venue',
})
export default class Venue extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ type: DataType.STRING(255), unique: true })
  declare name: string;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'allows_open_bar', type: DataType.BOOLEAN })
  declare allowsOpenBar: boolean;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  @ForeignKey(() => FinanceVendor)
  @AllowNull(true)
  @Column({ field: 'finance_vendor_id', type: DataType.INTEGER })
  declare financeVendorId: number | null;

  @BelongsTo(() => FinanceVendor, { foreignKey: 'finance_vendor_id', as: 'financeVendor' })
  declare financeVendor?: FinanceVendor | null;

  @ForeignKey(() => FinanceClient)
  @AllowNull(true)
  @Column({ field: 'finance_client_id', type: DataType.INTEGER })
  declare financeClientId: number | null;

  @BelongsTo(() => FinanceClient, { foreignKey: 'finance_client_id', as: 'financeClient' })
  declare financeClient?: FinanceClient | null;

  declare compensationTerms?: VenueCompensationTerm[];

  declare nightReportEntries?: NightReportVenue[];
}
