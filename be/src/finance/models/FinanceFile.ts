import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Index,
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
  @Column(DataType.STRING(255))
  declare originalName: string;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  declare mimeType: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare sizeBytes: number;

  @AllowNull(false)
  @Index('finance_files_drive_file_unique')
  @Column(DataType.STRING(128))
  declare driveFileId: string;

  @AllowNull(false)
  @Column(DataType.STRING(512))
  declare driveWebViewLink: string;

  @AllowNull(false)
  @Index('finance_files_sha256_unique')
  @Column(DataType.STRING(64))
  declare sha256: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare uploadedBy: number;

  @BelongsTo(() => User, 'uploadedBy')
  declare uploader?: User;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare uploadedAt: Date;
}

