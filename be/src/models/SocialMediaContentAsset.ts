import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import SocialMediaContent from './SocialMediaContent.js';
import User from './User.js';

export const SOCIAL_MEDIA_CONTENT_ASSET_KINDS = [
  'final_video',
  'raw_material',
  'project_file',
] as const;

export type SocialMediaContentAssetKind =
  typeof SOCIAL_MEDIA_CONTENT_ASSET_KINDS[number];

@Table({
  tableName: 'social_media_content_assets',
  modelName: 'SocialMediaContentAsset',
  timestamps: true,
  underscored: true,
})
export default class SocialMediaContentAsset extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => SocialMediaContent)
  @AllowNull(false)
  @Column({ field: 'content_id', type: DataType.INTEGER })
  declare contentId: number;

  @AllowNull(false)
  @Column(DataType.STRING(32))
  declare kind: SocialMediaContentAssetKind;

  @AllowNull(false)
  @Column({ field: 'original_name', type: DataType.STRING(255) })
  declare originalName: string;

  @AllowNull(false)
  @Column({ field: 'mime_type', type: DataType.STRING(255) })
  declare mimeType: string;

  @AllowNull(false)
  @Column({ field: 'size_bytes', type: DataType.BIGINT })
  declare sizeBytes: number;

  /** Private Google Drive locator. Never expose this value in API responses. */
  @AllowNull(false)
  @Column({ field: 'drive_file_id', type: DataType.STRING(255) })
  declare driveFileId: string;

  @AllowNull(false)
  @Column({ field: 'web_view_url', type: DataType.TEXT })
  declare webViewUrl: string;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'uploaded_by', type: DataType.INTEGER })
  declare uploadedBy: number | null;

  @BelongsTo(() => SocialMediaContent, { foreignKey: 'content_id', as: 'content' })
  declare content?: NonAttribute<SocialMediaContent>;

  @BelongsTo(() => User, { foreignKey: 'uploaded_by', as: 'uploadedByUser' })
  declare uploadedByUser?: NonAttribute<User | null>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
