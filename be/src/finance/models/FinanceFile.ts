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
} from 'sequelize-typescript';
import User from '../../models/User.js';

@Table({
  tableName: 'finance_files',
  timestamps: false,
  underscored: true,
})
export default class FinanceFile extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column({ field: 'original_name', type: DataType.STRING(255) })
  declare originalName: string;

  @AllowNull(false)
  @Column({ field: 'mime_type', type: DataType.STRING(120) })
  declare mimeType: string;

  @AllowNull(false)
  @Column({ field: 'size_bytes', type: DataType.INTEGER })
  declare sizeBytes: number;

  @AllowNull(false)
  @Column({ field: 'drive_file_id', type: DataType.STRING(128) })
  declare driveFileId: string;

  @AllowNull(false)
  @Column({ field: 'drive_web_view_link', type: DataType.STRING(512) })
  declare driveWebViewLink: string;

  @AllowNull(false)
  @Column({ field: 'sha256', type: DataType.STRING(64) })
  declare sha256: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'uploaded_by', type: DataType.INTEGER })
  declare uploadedBy: number;

  @BelongsTo(() => User, 'uploadedBy')
  declare uploader?: User;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'uploaded_at', type: DataType.DATE })
  declare uploadedAt: Date;
}
