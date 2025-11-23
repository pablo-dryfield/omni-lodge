import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
  HasMany,
} from 'sequelize-typescript';
import VenueCompensationTerm from './VenueCompensationTerm.js';
import NightReportVenue from './NightReportVenue.js';

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

  @HasMany(() => VenueCompensationTerm, { foreignKey: 'venue_id', as: 'compensationTerms' })
  declare compensationTerms?: VenueCompensationTerm[];

  @HasMany(() => NightReportVenue, { foreignKey: 'venue_id', as: 'nightReportEntries' })
  declare nightReportEntries?: NightReportVenue[];
}
