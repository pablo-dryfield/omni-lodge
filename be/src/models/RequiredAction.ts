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
} from 'sequelize-typescript';
import User from './User.js';

export type RequiredActionType = 'broadcast' | 'policy_consent' | 'profile_fields' | 'quiz' | 'assistant_manager_task' | 'custom';

@Table({
  timestamps: true,
  modelName: 'RequiredAction',
  tableName: 'required_actions',
  underscored: true,
})
export default class RequiredAction extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare type: RequiredActionType;

  @AllowNull(false)
  @Column(DataType.STRING)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare body: string | null;

  @AllowNull(false)
  @Default({})
  @Column(DataType.JSONB)
  declare payload: Record<string, unknown>;

  @AllowNull(true)
  @Column({ field: 'target_user_ids', type: DataType.JSONB })
  declare targetUserIds: number[] | null;

  @AllowNull(true)
  @Column({ field: 'target_user_type_ids', type: DataType.JSONB })
  declare targetUserTypeIds: number[] | null;

  @AllowNull(true)
  @Column({ field: 'target_shift_role_ids', type: DataType.JSONB })
  declare targetShiftRoleIds: number[] | null;

  @AllowNull(true)
  @Column({ field: 'target_staff_profile_types', type: DataType.JSONB })
  declare targetStaffProfileTypes: string[] | null;

  @AllowNull(false)
  @Default(true)
  @Column({ field: 'requires_completion', type: DataType.BOOLEAN })
  declare requiresCompletion: boolean;

  @AllowNull(false)
  @Default(false)
  @Column({ field: 'requires_signature', type: DataType.BOOLEAN })
  declare requiresSignature: boolean;

  @AllowNull(true)
  @Column({ field: 'starts_at', type: DataType.DATE })
  declare startsAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'due_at', type: DataType.DATE })
  declare dueAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date | null;

  @AllowNull(false)
  @Default(true)
  @Column(DataType.BOOLEAN)
  declare status: boolean;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'updated_by', type: DataType.INTEGER })
  declare updatedBy: number | null;
}
