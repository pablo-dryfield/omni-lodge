import {
  AllowNull,
  AutoIncrement,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';
import User from './User.js';
import CerebroSection from './CerebroSection.js';

export type CerebroEntryKind = 'faq' | 'tutorial' | 'playbook' | 'policy';

export type CerebroMediaItem = {
  type: 'image' | 'gif';
  url: string;
  caption?: string | null;
  alt?: string | null;
};

@Table({
  timestamps: true,
  modelName: 'CerebroEntry',
  tableName: 'cerebro_entries',
})
export default class CerebroEntry extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => CerebroSection)
  @AllowNull(false)
  @Column({ field: 'section_id', type: DataType.INTEGER })
  declare sectionId: number;

  @Unique
  @AllowNull(false)
  @Column(DataType.STRING)
  declare slug: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare category: string | null;

  @AllowNull(false)
  @Default('faq')
  @Column(DataType.STRING)
  declare kind: CerebroEntryKind;

  @AllowNull(true)
  @Column(DataType.STRING)
  declare summary: string | null;

  @AllowNull(false)
  @Default('')
  @Column(DataType.TEXT)
  declare body: string;

  @AllowNull(false)
  @Default([])
  @Column(DataType.JSONB)
  declare media: CerebroMediaItem[];

  @AllowNull(false)
  @Default([])
  @Column({ field: 'checklist_items', type: DataType.JSONB })
  declare checklistItems: string[];

  @AllowNull(false)
  @Default([])
  @Column({ field: 'target_user_type_ids', type: DataType.JSONB })
  declare targetUserTypeIds: number[];

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'requires_acknowledgement', type: DataType.BOOLEAN })
  declare requiresAcknowledgement: boolean;

  @AllowNull(true)
  @Column({ field: 'policy_version', type: DataType.STRING })
  declare policyVersion: string | null;

  @AllowNull(true)
  @Column({ field: 'estimated_read_minutes', type: DataType.INTEGER })
  declare estimatedReadMinutes: number | null;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'sort_order', type: DataType.INTEGER })
  declare sortOrder: number;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare status: boolean;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;
}
