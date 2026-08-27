import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from './User.js';

export type WhatsAppEmbeddedSignupAttemptStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export type WhatsAppOnboardingOperationStatus =
  | 'not_started'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'unknown';

@Table({
  timestamps: true,
  modelName: 'WhatsAppEmbeddedSignupAttempt',
  tableName: 'whatsapp_embedded_signup_attempts',
  underscored: true,
})
export default class WhatsAppEmbeddedSignupAttempt extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Index('whatsapp_embedded_signup_attempts_admin_created_idx')
  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'admin_user_id', type: DataType.INTEGER })
  declare adminUserId: number;

  @AllowNull(false)
  @Column({ field: 'nonce_hash', type: DataType.CHAR(64) })
  declare nonceHash: string;

  @Index('whatsapp_embedded_signup_attempts_status_expiry_idx')
  @AllowNull(false)
  @Default('pending')
  @Column(DataType.STRING(32))
  declare status: WhatsAppEmbeddedSignupAttemptStatus;

  @Index('whatsapp_embedded_signup_attempts_status_expiry_idx')
  @AllowNull(false)
  @Column({ field: 'expires_at', type: DataType.DATE })
  declare expiresAt: Date;

  @AllowNull(true)
  @Column({ field: 'waba_id', type: DataType.STRING(64) })
  declare wabaId: string | null;

  @AllowNull(true)
  @Column({ field: 'phone_number_id', type: DataType.STRING(64) })
  declare phoneNumberId: string | null;

  @AllowNull(true)
  @Column({ field: 'onboarding_generation', type: DataType.STRING(64) })
  declare onboardingGeneration: string | null;

  @AllowNull(true)
  @Column({ field: 'token_stored_at', type: DataType.DATE })
  declare tokenStoredAt: Date | null;

  @AllowNull(false)
  @Default('not_started')
  @Column({ field: 'subscription_status', type: DataType.STRING(32) })
  declare subscriptionStatus: Exclude<WhatsAppOnboardingOperationStatus, 'claimed'>;

  @AllowNull(true)
  @Column({ field: 'subscription_attempted_at', type: DataType.DATE })
  declare subscriptionAttemptedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'subscribed_at', type: DataType.DATE })
  declare subscribedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'recovery_lease_at', type: DataType.DATE })
  declare recoveryLeaseAt: Date | null;

  @AllowNull(false)
  @Default('not_started')
  @Column({ field: 'app_state_sync_status', type: DataType.STRING(32) })
  declare appStateSyncStatus: WhatsAppOnboardingOperationStatus;

  @AllowNull(true)
  @Column({ field: 'app_state_sync_request_id', type: DataType.STRING(256) })
  declare appStateSyncRequestId: string | null;

  @AllowNull(true)
  @Column({ field: 'app_state_sync_claimed_at', type: DataType.DATE })
  declare appStateSyncClaimedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'app_state_sync_completed_at', type: DataType.DATE })
  declare appStateSyncCompletedAt: Date | null;

  @AllowNull(false)
  @Default('not_started')
  @Column({ field: 'history_sync_status', type: DataType.STRING(32) })
  declare historySyncStatus: WhatsAppOnboardingOperationStatus;

  @AllowNull(true)
  @Column({ field: 'history_sync_request_id', type: DataType.STRING(256) })
  declare historySyncRequestId: string | null;

  @AllowNull(true)
  @Column({ field: 'history_sync_claimed_at', type: DataType.DATE })
  declare historySyncClaimedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'history_sync_completed_at', type: DataType.DATE })
  declare historySyncCompletedAt: Date | null;

  @AllowNull(true)
  @Column({ field: 'error_code', type: DataType.STRING(64) })
  declare errorCode: string | null;

  @AllowNull(true)
  @Column({ field: 'completed_at', type: DataType.DATE })
  declare completedAt: Date | null;

  @BelongsTo(() => User, { foreignKey: 'admin_user_id', as: 'adminUser' })
  declare adminUser?: User;
}
