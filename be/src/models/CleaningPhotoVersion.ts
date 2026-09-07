import { AllowNull, AutoIncrement, Column, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import CleaningSubmission from './CleaningSubmission.js';
import User from './User.js';

@Table({ tableName: 'cleaning_photo_versions', modelName: 'CleaningPhotoVersion', timestamps: true, underscored: true })
export default class CleaningPhotoVersion extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @ForeignKey(() => CleaningSubmission) @AllowNull(false) @Column({ field: 'submission_id', type: DataType.INTEGER }) declare submissionId: number;
  @AllowNull(false) @Column({ field: 'slot_key', type: DataType.STRING(160) }) declare slotKey: string;
  @AllowNull(false) @Column(DataType.INTEGER) declare version: number;
  @AllowNull(true) @Column({ field: 'storage_path', type: DataType.TEXT }) declare storagePath: string | null;
  @AllowNull(true) @Column({ field: 'drive_file_id', type: DataType.STRING(255) }) declare driveFileId: string | null;
  @AllowNull(true) @Column({ field: 'drive_web_view_link', type: DataType.TEXT }) declare driveWebViewLink: string | null;
  @AllowNull(false) @Column({ field: 'file_name', type: DataType.STRING(255) }) declare fileName: string;
  @AllowNull(false) @Column({ field: 'mime_type', type: DataType.STRING(80) }) declare mimeType: string;
  @AllowNull(false) @Column({ field: 'file_size', type: DataType.INTEGER }) declare fileSize: number;
  @AllowNull(false) @Column(DataType.STRING(64)) declare sha256: string;
  @AllowNull(false) @Column(DataType.INTEGER) declare width: number;
  @AllowNull(false) @Column(DataType.INTEGER) declare height: number;
  @AllowNull(false) @Default('pending') @Column(DataType.STRING(16)) declare status: 'pending' | 'approved' | 'rejected';
  @ForeignKey(() => User) @AllowNull(false) @Column({ field: 'uploaded_by', type: DataType.INTEGER }) declare uploadedBy: number;
  @AllowNull(false) @Column({ field: 'uploaded_at', type: DataType.DATE }) declare uploadedAt: Date;
  @ForeignKey(() => User) @AllowNull(true) @Column({ field: 'reviewed_by', type: DataType.INTEGER }) declare reviewedBy: number | null;
  @AllowNull(true) @Column({ field: 'reviewed_at', type: DataType.DATE }) declare reviewedAt: Date | null;
  @AllowNull(true) @Column({ field: 'rejection_reason', type: DataType.TEXT }) declare rejectionReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
