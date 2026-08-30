import type { Transaction as SequelizeTransaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import StaffPayoutSettlementRequest from '../models/StaffPayoutSettlementRequest.js';

type SettlementRequestBindingParams = {
  staffUserId: number;
  requestId: string;
  payoutBatchKey: string;
  transaction?: SequelizeTransaction;
};

/**
 * Checks the immutable request-id ledger. The row deliberately survives
 * payout deletion and fund reversal, so a delayed retry cannot recreate an
 * intentionally removed settlement.
 */
export const assertStaffPayoutSettlementRequestBinding = async (
  params: SettlementRequestBindingParams,
): Promise<StaffPayoutSettlementRequest | null> => {
  const binding = await StaffPayoutSettlementRequest.findOne({
    where: {
      staffUserId: params.staffUserId,
      requestId: params.requestId,
    },
    ...(params.transaction
      ? { transaction: params.transaction, lock: params.transaction.LOCK.UPDATE }
      : {}),
  });
  if (!binding) {
    return null;
  }
  if (binding.payoutBatchKey !== params.payoutBatchKey) {
    throw new HttpError(
      409,
      'This settlement request was already used with different payout details. Start a new payment and try again.',
    );
  }
  return binding;
};

export const createStaffPayoutSettlementRequestBinding = async (params: {
  staffUserId: number;
  requestId: string;
  payoutBatchKey: string;
  actorId: number;
  transaction: SequelizeTransaction;
}): Promise<StaffPayoutSettlementRequest> => StaffPayoutSettlementRequest.create(
  {
    staffUserId: params.staffUserId,
    requestId: params.requestId,
    payoutBatchKey: params.payoutBatchKey,
    createdBy: params.actorId,
  },
  { transaction: params.transaction },
);
