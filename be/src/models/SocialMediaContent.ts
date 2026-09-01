import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';
import User from './User.js';

export const SOCIAL_MEDIA_CONTENT_STATUSES = [
  'idea',
  'planned',
  'in_production',
  'ready',
  'published',
  'archived',
] as const;

export type SocialMediaContentStatus = typeof SOCIAL_MEDIA_CONTENT_STATUSES[number];

@Table({
  tableName: 'social_media_contents',
  modelName: 'SocialMediaContent',
  timestamps: true,
  underscored: true,
})
export default class SocialMediaContent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING(180))
  declare title: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare idea: string;

  @AllowNull(false)
  @Default('')
  @Column({ field: 'on_video_captions', type: DataType.TEXT })
  declare onVideoCaptions: string;

  @AllowNull(false)
  @Default('')
  @Column({ field: 'platform_caption', type: DataType.TEXT })
  declare platformCaption: string;

  @AllowNull(false)
  @Default([])
  @Column(DataType.JSONB)
  declare hashtags: string[];

  @AllowNull(false)
  @Default([])
  @Column({ field: 'target_platforms', type: DataType.JSONB })
  declare targetPlatforms: string[];

  @AllowNull(false)
  @Default('idea')
  @Column(DataType.STRING(32))
  declare status: SocialMediaContentStatus;

  @AllowNull(true)
  @Column({ field: 'scheduled_at', type: DataType.DATE })
  declare scheduledAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'published_at', type: DataType.DATE })
  declare publishedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'drive_project_url', type: DataType.TEXT })
  declare driveProjectUrl: string | null;

  @AllowNull(false)
  @Default({})
  @Column({ field: 'platform_links', type: DataType.JSONB })
  declare platformLinks: Record<string, string>;

  @AllowNull(true)
  @Column({ field: 'thumbnail_url', type: DataType.TEXT })
  declare thumbnailUrl: string | null;

  /** Private Google Drive locator. Never expose this value in API responses. */
  @AllowNull(true)
  @Column({ field: 'thumbnail_drive_file_id', type: DataType.STRING(255) })
  declare thumbnailDriveFileId: string | null;

  @AllowNull(true)
  @Column({ field: 'thumbnail_original_name', type: DataType.STRING(255) })
  declare thumbnailOriginalName: string | null;

  @AllowNull(true)
  @Column({ field: 'thumbnail_mime_type', type: DataType.STRING(100) })
  declare thumbnailMimeType: string | null;

  @AllowNull(true)
  @Column({ field: 'archived_at', type: DataType.DATE })
  declare archivedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User | null>;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'updatedByUser' })
  declare updatedByUser?: NonAttribute<User | null>;

  @CreatedAt
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date;
}
