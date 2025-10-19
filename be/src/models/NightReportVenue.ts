import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  Default,
} from 'sequelize-typescript';
import type NightReport from './NightReport.js';

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

  declare report?: NightReport;
}
