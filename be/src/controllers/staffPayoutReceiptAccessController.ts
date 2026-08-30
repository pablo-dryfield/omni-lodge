import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import { StaffPayoutReceiptSafeError } from '../errors/StaffPayoutReceiptError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import {
  assertStaffPayoutReceiptAccessState,
  exchangeStaffPayoutReceiptCredentials,
} from '../services/staffPayoutReceiptAccessService.js';
import {
  StaffPayoutReceiptAccessTokenConfigurationError,
} from '../services/staffPayoutReceiptAccessTokenService.js';
import {
  confirmStaffPayoutReceipt,
  getStaffPayoutReceiptActionPayload,
} from '../services/staffPayoutReceiptService.js';

const requireReceiptAccessContext = (req: AuthenticatedRequest) => {
  if (!req.receiptAccess) {
    throw new HttpError(401, 'Unable to access this payout receipt.');
  }
  return req.receiptAccess;
};

const sendAccessError = (
  res: Response,
  error: unknown,
  operation: string,
): void => {
  if (error instanceof StaffPayoutReceiptAccessTokenConfigurationError) {
    res.status(503).json([{ message: 'Payout receipt access is temporarily unavailable.' }]);
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message }]);
    return;
  }
  if (error instanceof StaffPayoutReceiptSafeError) {
    res.status(error.status).json([{ message: error.message, code: error.code }]);
    return;
  }
  logger.error(`[staff-payout-receipt-access] ${operation} failed`, error);
  res.status(500).json([{ message: 'Unable to process payout receipt access.' }]);
};

export const exchangeStaffPayoutReceiptAccess = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await exchangeStaffPayoutReceiptCredentials({
      identity: req.body?.identity ?? req.body?.email,
      password: req.body?.password,
      receiptId: req.body?.receiptId,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      accessToken: result.token,
      tokenType: 'Bearer',
      expiresAt: result.expiresAt,
      expiresInSeconds: result.expiresInSeconds,
      receiptId: result.receiptId,
      actionId: result.actionId,
    });
  } catch (error) {
    sendAccessError(res, error, 'credential exchange');
  }
};

export const getStaffPayoutReceiptAccess = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const access = requireReceiptAccessContext(req);
    await assertStaffPayoutReceiptAccessState(access);
    const receipt = await getStaffPayoutReceiptActionPayload({
      receiptId: access.receiptId,
      actionId: access.actionId,
      staffUserId: access.userId,
    });
    if (!receipt) {
      throw new HttpError(409, 'This payout receipt request is no longer pending.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ actionId: access.actionId, receipt });
  } catch (error) {
    sendAccessError(res, error, 'receipt load');
  }
};

export const confirmStaffPayoutReceiptAccess = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const access = requireReceiptAccessContext(req);
    const receipt = await confirmStaffPayoutReceipt({
      receiptId: access.receiptId,
      actionId: access.actionId,
      actorId: access.userId,
      photo: req.file,
      signature: req.body?.signature,
      acknowledgedAmount: req.body?.acknowledgedAmount,
      acknowledgedAt: req.body?.acknowledgedAt,
      confirmationIp: req.ip || null,
      confirmationUserAgent: req.get('user-agent') ?? null,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ completed: true, receipt });
  } catch (error) {
    sendAccessError(res, error, 'receipt confirmation');
  }
};
