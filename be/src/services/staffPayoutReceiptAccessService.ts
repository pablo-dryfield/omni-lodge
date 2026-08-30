import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import RequiredAction from '../models/RequiredAction.js';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import User from '../models/User.js';
import {
  issueStaffPayoutReceiptAccessToken,
  type StaffPayoutReceiptAccessClaims,
} from './staffPayoutReceiptAccessTokenService.js';

const INVALID_RECEIPT_ACCESS_MESSAGE = 'Unable to access this payout receipt.';
const DUMMY_PASSWORD_HASH = '$2a$10$0.5HsDRd/RirWGqplg5Afu7zv5PWLUZntrrDIXpbcLUdQu5VZXRNm';

export type StaffPayoutReceiptAccessState = {
  user: User;
  receipt: StaffPayoutReceipt;
  action: RequiredAction;
};

export type StaffPayoutReceiptCredentialExchangeResult = {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
  receiptId: number;
  actionId: number;
};

const invalidReceiptAccess = (): HttpError =>
  new HttpError(401, INVALID_RECEIPT_ACCESS_MESSAGE, {
    code: 'STAFF_PAYOUT_RECEIPT_ACCESS_DENIED',
  });

const isActionAvailableAt = (action: RequiredAction, now: Date): boolean => {
  const startsAt = action.startsAt ? new Date(action.startsAt) : null;
  const expiresAt = action.expiresAt ? new Date(action.expiresAt) : null;
  return (
    action.status === true
    && (!startsAt || startsAt.getTime() <= now.getTime())
    && (!expiresAt || expiresAt.getTime() > now.getTime())
  );
};

const actionTargetsOnlyStaffUser = (action: RequiredAction, staffUserId: number): boolean => {
  const targets = Array.isArray(action.targetUserIds)
    ? action.targetUserIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)
    : [];
  return targets.length === 1 && targets[0] === staffUserId;
};

const actionPayloadMatchesReceipt = (action: RequiredAction, receiptId: number): boolean => {
  const payload = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
    ? action.payload
    : {};
  return Number(payload.receiptId) === receiptId;
};

export const assertStaffPayoutReceiptAccessState = async (
  claims: Pick<StaffPayoutReceiptAccessClaims, 'userId' | 'receiptId' | 'actionId'>,
  options: { now?: Date } = {},
): Promise<StaffPayoutReceiptAccessState> => {
  const now = options.now ?? new Date();
  const [user, receipt, action] = await Promise.all([
    User.findByPk(claims.userId, {
      attributes: ['id', 'approved', 'userTypeId', 'status'],
    }),
    StaffPayoutReceipt.findByPk(claims.receiptId),
    RequiredAction.findByPk(claims.actionId),
  ]);

  if (
    !user
    || !user.approved
    || !user.userTypeId
    || !receipt
    || receipt.staffUserId !== claims.userId
    || receipt.requiredActionId !== claims.actionId
    || receipt.status !== 'pending'
    || !action
    || action.type !== 'staff_payout_receipt'
    || !action.requiresCompletion
    || !action.requiresSignature
    || !isActionAvailableAt(action, now)
    || !actionTargetsOnlyStaffUser(action, claims.userId)
    || !actionPayloadMatchesReceipt(action, claims.receiptId)
  ) {
    throw invalidReceiptAccess();
  }

  // Deliberately do not require user.status here. This is the only account
  // lifecycle check bypassed by receipt-only access; approval and user type
  // remain mandatory, and the caller receives no normal authorization context.
  return { user, receipt, action };
};

export const exchangeStaffPayoutReceiptCredentials = async (params: {
  identity: unknown;
  password: unknown;
  receiptId: unknown;
  now?: Date;
}): Promise<StaffPayoutReceiptCredentialExchangeResult> => {
  const identity = typeof params.identity === 'string' ? params.identity.trim() : '';
  const password = typeof params.password === 'string' && params.password.length <= 512
    ? params.password
    : '';
  const receiptId = Number(params.receiptId);
  const user = identity && identity.length <= 255
    ? await User.findOne({
        where: { [Op.or]: [{ email: identity }, { username: identity }] },
      })
    : null;

  const passwordMatches = await bcrypt.compare(
    password,
    user?.password || DUMMY_PASSWORD_HASH,
  );
  if (
    !user
    || !passwordMatches
    || !user.approved
    || !user.userTypeId
    || !Number.isSafeInteger(receiptId)
    || receiptId <= 0
  ) {
    throw invalidReceiptAccess();
  }

  const receipt = await StaffPayoutReceipt.findByPk(receiptId, {
    attributes: ['id', 'staffUserId', 'requiredActionId', 'status'],
  });
  if (!receipt?.requiredActionId) {
    throw invalidReceiptAccess();
  }

  const state = await assertStaffPayoutReceiptAccessState(
    {
      userId: user.id,
      receiptId,
      actionId: receipt.requiredActionId,
    },
    { now: params.now },
  );
  const issued = issueStaffPayoutReceiptAccessToken(
    {
      userId: state.user.id,
      receiptId: state.receipt.id,
      actionId: state.action.id,
    },
    { now: params.now },
  );

  return {
    token: issued.token,
    expiresAt: new Date(issued.expiresAt * 1000).toISOString(),
    expiresInSeconds: issued.expiresInSeconds,
    receiptId: state.receipt.id,
    actionId: state.action.id,
  };
};
