import {
  Model,
  Table,
  Column,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import type NightReport from './NightReport.js';
import User from './User.js';

@Table({
  timestamps: true,
  modelName: 'NightReportPhoto',
  tableName: 'night_report_photos',
})
export default class NightReportPhoto extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'report_id', type: DataType.INTEGER })
  declare reportId: number;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'uploader_id', type: DataType.INTEGER })
  declare uploaderId: number;

  @AllowNull(false)
  @Column({ field: 'storage_path', type: DataType.STRING(512) })
  declare storagePath: string;

  @AllowNull(false)
  @Column({ field: 'original_name', type: DataType.STRING(255) })
  declare originalName: string;

  @AllowNull(false)
  @Column({ field: 'mime_type', type: DataType.STRING(100) })
  declare mimeType: string;

  @AllowNull(false)
  @Column({ field: 'file_size', type: DataType.INTEGER })
  declare fileSize: number;

  @AllowNull(true)
  @Column({ field: 'captured_at', type: DataType.DATE })
  declare capturedAt: Date | null;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  declare report?: NightReport;

  @BelongsTo(() => User, { foreignKey: 'uploaderId', as: 'uploader' })
  declare uploader?: User;
}
