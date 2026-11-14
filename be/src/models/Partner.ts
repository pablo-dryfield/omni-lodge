import type { PartnerCommissionCalculation } from '../services/partners/partnerCommission.js';
import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, AutoIncrement, Table, UpdatedAt } from 'sequelize-typescript';
import type { PartnerAgreement } from '../services/partners/partnerPolicy.js';

class PartnerRow extends Model {
  @PrimaryKey @AutoIncrement @Column(DataType.INTEGER) declare id: number;
  @CreatedAt @Column({ field: 'created_at', type: DataType.DATE }) declare createdAt: Date;
  @UpdatedAt @Column({ field: 'updated_at', type: DataType.DATE }) declare updatedAt: Date;
}

@Table({ tableName: 'partner_profiles', timestamps: true })
export class PartnerProfile extends PartnerRow {
  @AllowNull(false) @Column({ field: 'channel_id', type: DataType.INTEGER, unique: true }) declare channelId: number;
  @AllowNull(false) @Column({ field: 'public_code', type: DataType.STRING(64), unique: true }) declare publicCode: string;
  @AllowNull(false) @Column(DataType.STRING(160)) declare name: string;
  @Default('active') @Column(DataType.STRING(24)) declare status: string;
  @AllowNull(false) @Column(DataType.JSONB) declare agreement: PartnerAgreement;
  @Default(1) @Column(DataType.INTEGER) declare version: number;
  @AllowNull(false) @Column({ field: 'created_by', type: DataType.INTEGER }) declare createdBy: number;
  @Column({ field: 'connect_accounts', type: DataType.JSONB }) declare connectAccounts: Record<string, string> | null;
}

@Table({ tableName: 'partner_members', timestamps: true })
export class PartnerMember extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER }) declare partnerId: number;
  @AllowNull(false) @Column({ field: 'user_id', type: DataType.INTEGER }) declare userId: number;
  @AllowNull(false) @Column(DataType.STRING(20)) declare role: 'owner' | 'agent' | 'developer';
  @Default(true) @Column(DataType.BOOLEAN) declare active: boolean;
}

@Table({ tableName: 'partner_credentials', timestamps: true })
export class PartnerCredential extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER }) declare partnerId: number;
  @AllowNull(false) @Column(DataType.STRING(100)) declare label: string;
  @AllowNull(false) @Column({ field: 'token_hash', type: DataType.STRING(64), unique: true }) declare tokenHash: string;
  @AllowNull(false) @Column(DataType.JSONB) declare scopes: string[];
  @Column({ field: 'expires_at', type: DataType.DATE }) declare expiresAt: Date;
  @Column({ field: 'revoked_at', type: DataType.DATE }) declare revokedAt: Date | null;
  @Column({ field: 'last_used_at', type: DataType.DATE }) declare lastUsedAt: Date | null;
}

@Table({ tableName: 'partner_bookings', timestamps: true })
export class PartnerBooking extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER }) declare partnerId: number;
  @AllowNull(false) @Column({ field: 'external_reference', type: DataType.STRING(160) }) declare externalReference: string;
  @AllowNull(false) @Column({ field: 'request_hash', type: DataType.STRING(64) }) declare requestHash: string;
  @Column({ field: 'order_id', type: DataType.BIGINT, unique: true }) declare orderId: number | null;
  @Default('requested') @Column(DataType.STRING(32)) declare status: string;
  @AllowNull(false) @Column({ field: 'payment_mode', type: DataType.STRING(24) }) declare paymentMode: 'platform' | 'partner' | 'arrival';
  @AllowNull(false) @Column(DataType.STRING(24)) declare source: string;
  @AllowNull(false) @Column(DataType.JSONB) declare selection: Record<string, unknown>;
  @AllowNull(false) @Column(DataType.JSONB) declare snapshot: PartnerAgreement;
  @Default(0) @Column(DataType.DECIMAL(12, 2)) declare total: number;
  @Default(0) @Column(DataType.DECIMAL(12, 2)) declare commission: number;
  @Column({ field: 'commission_calculation', type: DataType.JSONB }) declare commissionCalculation: PartnerCommissionCalculation | null;
  @Column({ field: 'commission_transferred', type: DataType.DECIMAL(12, 2) }) declare commissionTransferred: number | null;
  @Column({ field: 'commission_earned', type: DataType.DECIMAL(12, 2) }) declare commissionEarned: number | null;
  @Default(false) @Column({ field: 'payment_received', type: DataType.BOOLEAN }) declare paymentReceived: boolean;
  @Default(0) @Column({ field: 'refunded_amount', type: DataType.DECIMAL(12, 2) }) declare refundedAmount: number;
  @Default(0) @Column({ field: 'amendment_refunded_amount', type: DataType.DECIMAL(12, 2) }) declare amendmentRefundedAmount: number;
  @Default(0) @Column({ field: 'settled_amount', type: DataType.DECIMAL(12, 2) }) declare settledAmount: number;
  @Default(0) @Column({ field: 'partner_credit_paid', type: DataType.DECIMAL(12, 2) }) declare partnerCreditPaid: number;
  @Column({ field: 'transfer_id', type: DataType.STRING(128) }) declare transferId: string | null;
  @Default(0) @Column({ field: 'reversed_amount', type: DataType.INTEGER }) declare reversedAmount: number;
  @Column({ field: 'checkout_url', type: DataType.TEXT }) declare checkoutUrl: string | null;
  @Column({ field: 'access_hash', type: DataType.STRING(64) }) declare accessHash: string | null;
  @Column({ field: 'created_by', type: DataType.INTEGER }) declare createdBy: number | null;
  @Column({ field: 'reconciliation_error', type: DataType.STRING(256) }) declare reconciliationError: string | null;
}

@Table({ tableName: 'partner_offerings', timestamps: true })
export class PartnerOffering extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER }) declare partnerId: number;
  @AllowNull(false) @Column(DataType.STRING(64)) declare code: string;
  @AllowNull(false) @Column(DataType.STRING(20)) declare kind: 'package' | 'voucher';
  @AllowNull(false) @Column(DataType.STRING(160)) declare name: string;
  @AllowNull(false) @Column(DataType.JSONB) declare items: Array<{ productId: number; quantity: number; experienceTime?: string }>;
  @Default(true) @Column(DataType.BOOLEAN) declare active: boolean;
}

@Table({ tableName: 'partner_events', timestamps: true })
export class PartnerEvent extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER }) declare partnerId: number;
  @Column({ field: 'booking_id', type: DataType.INTEGER }) declare bookingId: number | null;
  @Column({ field: 'actor_id', type: DataType.INTEGER }) declare actorId: number | null;
  @AllowNull(false) @Column(DataType.STRING(80)) declare type: string;
  @AllowNull(false) @Column(DataType.JSONB) declare data: Record<string, unknown>;
}

@Table({ tableName: 'partner_webhooks', timestamps: true })
export class PartnerWebhook extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER, unique: true }) declare partnerId: number;
  @AllowNull(false) @Column(DataType.TEXT) declare url: string;
  @AllowNull(false) @Column(DataType.JSONB) declare secret: { encryptedValue: string; iv: string; tag: string };
  @Default(true) @Column(DataType.BOOLEAN) declare active: boolean;
}

@Table({ tableName: 'partner_deliveries', timestamps: true })
export class PartnerDelivery extends PartnerRow {
  @AllowNull(false) @Column({ field: 'partner_id', type: DataType.INTEGER }) declare partnerId: number;
  @AllowNull(false) @Column({ field: 'event_id', type: DataType.INTEGER }) declare eventId: number;
  @Default(0) @Column(DataType.INTEGER) declare attempts: number;
  @Default('pending') @Column(DataType.STRING(24)) declare status: string;
  @Column({ field: 'next_attempt_at', type: DataType.DATE }) declare nextAttemptAt: Date | null;
  @Column({ field: 'last_status', type: DataType.INTEGER }) declare lastStatus: number | null;
}

@Table({ tableName: 'partner_payments', timestamps: true })
export class PartnerPayment extends PartnerRow {
  @AllowNull(false) @Column({ field: 'booking_id', type: DataType.INTEGER }) declare bookingId: number;
  @AllowNull(false) @Column(DataType.STRING(80)) declare reference: string;
  @AllowNull(false) @Column(DataType.DECIMAL(12, 2)) declare amount: number;
  @AllowNull(false) @Column(DataType.DECIMAL(12, 2)) declare commission: number;
  @Column({ field: 'payment_intent_id', type: DataType.STRING(128), unique: true }) declare paymentIntentId: string | null;
  @Column({ field: 'transfer_id', type: DataType.STRING(128) }) declare transferId: string | null;
  @Default(0) @Column({ field: 'reversed_amount', type: DataType.INTEGER }) declare reversedAmount: number;
}

@Table({ tableName: 'partner_amendments', timestamps: true })
export class PartnerAmendment extends PartnerRow {
  @AllowNull(false) @Column({ field: 'booking_id', type: DataType.INTEGER }) declare bookingId: number;
  @AllowNull(false) @Column(DataType.STRING(160)) declare reference: string;
  @AllowNull(false) @Column({ field: 'request_hash', type: DataType.STRING(64) }) declare requestHash: string;
  @AllowNull(false) @Column({ field: 'previous_hash', type: DataType.STRING(64) }) declare previousHash: string;
  @AllowNull(false) @Column(DataType.JSONB) declare selection: Record<string, unknown>;
  @AllowNull(false) @Column(DataType.JSONB) declare quote: Record<string, unknown>;
  @AllowNull(false) @Column(DataType.STRING(24)) declare status: string;
  @AllowNull(false) @Column(DataType.DECIMAL(12, 2)) declare difference: number;
  @AllowNull(false) @Column(DataType.STRING(1000)) declare reason: string;
  @Column({ field: 'actor_id', type: DataType.INTEGER }) declare actorId: number | null;
  @Default(true) @Column({ field: 'notify_customer', type: DataType.BOOLEAN }) declare notifyCustomer: boolean;
  @Column({ field: 'checkout_session_id', type: DataType.STRING(128), unique: true }) declare checkoutSessionId: string | null;
  @Column({ field: 'checkout_url', type: DataType.TEXT }) declare checkoutUrl: string | null;
  @Column({ field: 'payment_email_sent_at', type: DataType.DATE }) declare paymentEmailSentAt: Date | null;
  @Column({ field: 'notification_sent_at', type: DataType.DATE }) declare notificationSentAt: Date | null;
  @Column({ field: 'failure_reason', type: DataType.STRING(256) }) declare failureReason: string | null;
}

export const partnerModels = [PartnerProfile, PartnerMember, PartnerCredential, PartnerBooking, PartnerOffering, PartnerEvent, PartnerWebhook, PartnerDelivery, PartnerPayment, PartnerAmendment];
