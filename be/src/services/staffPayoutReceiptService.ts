import type { Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../config/database.js';
import FinanceFile from '../finance/models/FinanceFile.js';
import RequiredAction from '../models/RequiredAction.js';
import RequiredActionCompletion from '../models/RequiredActionCompletion.js';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../models/StaffPayoutReceiptItem.js';
import User from '../models/User.js';
import {
  deleteStoredStaffPayoutReceiptFile,
  storeStaffPayoutReceiptFile,
} from './staffPayoutReceiptStorageService.js';
import {
  assertStaffPayoutAcknowledgedAmount,
  assertStaffPayoutReceiptActor,
  decodeStaffPayoutSignatureDataUrl,
  validateStaffPayoutReceiptPhoto,
} from './staffPayoutReceiptValidation.js';

export const STAFF_PAYOUT_RECEIPT_ACCEPTANCE_VERSION = 'v1';

export type StaffPayoutReceiptSourceItem = {
  collectionLogId: number;
  financeTransactionId: number | null;
  label: string;
  amountMinor: number;
  currencyCode: string;
};

type CreateStaffPayoutReceiptParams = {
  staffUserId: number;
  payoutBatchKey: string;
  rangeStart: string;
  rangeEnd: string;
  paidDate: string;
  createdBy: number;
  items: StaffPayoutReceiptSourceItem[];
  transaction: SequelizeTransaction;
};

export type StaffPayoutReceiptActionPayload = {
  id: number;
  amount: number;
  amountMinor: number;
  currency: string;
  rangeStart: string;
  rangeEnd: string;
  payoutDate: string;
  paidByName: string;
  acceptanceText: string;
  acceptanceVersion: string;
  items: Array<{
    id: number;
    label: string;
    amount: number;
    amountMinor: number;
  }>;
};

const toCurrencyCode = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const formatUserName = (user: User): string => {
  const fullName = [user.firstName, user.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return fullName || user.username || user.email || `User #${user.id}`;
};

const formatMoneyForAcceptance = (amountMinor: number, currency: string): string =>
  `${(amountMinor / 100).toFixed(2)} ${currency}`;

const buildAcceptanceText = (params: {
  amountMinor: number;
  currency: string;
  paidByName: string;
  paidDate: string;
  rangeStart: string;
  rangeEnd: string;
}): string =>
  `I confirm that I received ${formatMoneyForAcceptance(params.amountMinor, params.currency)} from ${params.paidByName} on ${params.paidDate} for staff compensation covering ${params.rangeStart} through ${params.rangeEnd}.`;

const getReceiptItems = (receipt: StaffPayoutReceipt): StaffPayoutReceiptItem[] =>
  ((receipt as StaffPayoutReceipt & { items?: StaffPayoutReceiptItem[] }).items ?? []);

const buildReceiptActionPayload = (receipt: StaffPayoutReceipt): StaffPayoutReceiptActionPayload => {
  const items = getReceiptItems(receipt);
  const amountMinor = items.reduce((sum, item) => sum + Number(item.amountMinor), 0);
  const currency = toCurrencyCode(items[0]?.currencyCode);
  if (!/^[A-Z]{3}$/.test(currency) || items.some((item) => toCurrencyCode(item.currencyCode) !== currency)) {
    throw new Error('Payout receipt contains inconsistent currencies.');
  }
  return {
    id: receipt.id,
    amount: amountMinor / 100,
    amountMinor,
    currency,
    rangeStart: receipt.rangeStart,
    rangeEnd: receipt.rangeEnd,
    payoutDate: receipt.paidDate,
    paidByName: receipt.paidByName,
    acceptanceText: receipt.acceptanceText,
    acceptanceVersion: receipt.acceptanceVersion,
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      amount: Number(item.amountMinor) / 100,
      amountMinor: Number(item.amountMinor),
    })),
  };
};

export async function createStaffPayoutReceipt(
  params: CreateStaffPayoutReceiptParams,
): Promise<StaffPayoutReceipt> {
  if (params.items.length === 0) {
    throw new Error('A payout receipt requires at least one payment item.');
  }
  const currency = toCurrencyCode(params.items[0].currencyCode);
  if (!/^[A-Z]{3}$/.test(currency) || params.items.some((item) => toCurrencyCode(item.currencyCode) !== currency)) {
    throw new Error('Create one payout receipt per currency.');
  }
  const amountMinor = params.items.reduce((sum, item) => sum + item.amountMinor, 0);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Payout receipt amount must be positive.');
  }

  const existing = await StaffPayoutReceipt.findOne({
    where: { payoutBatchKey: params.payoutBatchKey, status: ['pending', 'completed'] },
    transaction: params.transaction,
  });
  if (existing) {
    return existing;
  }

  const payer = await User.findByPk(params.createdBy, {
    attributes: ['id', 'firstName', 'lastName', 'username', 'email'],
    transaction: params.transaction,
  });
  if (!payer) {
    throw new Error('Payout creator was not found.');
  }
  const paidByName = formatUserName(payer).slice(0, 255);
  const acceptanceText = buildAcceptanceText({
    amountMinor,
    currency,
    paidByName,
    paidDate: params.paidDate,
    rangeStart: params.rangeStart,
    rangeEnd: params.rangeEnd,
  });

  const receipt = await StaffPayoutReceipt.create(
    {
      staffUserId: params.staffUserId,
      requiredActionId: null,
      payoutBatchKey: params.payoutBatchKey,
      status: 'pending',
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      paidDate: params.paidDate,
      paidByName,
      acceptanceVersion: STAFF_PAYOUT_RECEIPT_ACCEPTANCE_VERSION,
      acceptanceText,
      photoFileId: null,
      signatureFileId: null,
      confirmedAt: null,
      confirmedBy: null,
      confirmationIp: null,
      confirmationUserAgent: null,
      clientAcknowledgedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdBy: params.createdBy,
    },
    { transaction: params.transaction },
  );

  await StaffPayoutReceiptItem.bulkCreate(
    params.items.map((item) => ({
      receiptId: receipt.id,
      collectionLogId: item.collectionLogId,
      collectionLogIdSnapshot: item.collectionLogId,
      financeTransactionId: item.financeTransactionId,
      financeTransactionIdSnapshot: item.financeTransactionId,
      label: (item.label.trim() || 'Staff payout').slice(0, 255),
      amountMinor: item.amountMinor,
      currencyCode: currency,
    })),
    { transaction: params.transaction },
  );

  const action = await RequiredAction.create(
    {
      type: 'staff_payout_receipt',
      title: 'Confirm payment received',
      body: `Please confirm that you received ${formatMoneyForAcceptance(amountMinor, currency)}. A photo and e-signature are required.`,
      payload: { receiptId: receipt.id },
      targetUserIds: [params.staffUserId],
      targetUserTypeIds: null,
      targetShiftRoleIds: null,
      targetStaffProfileTypes: null,
      requiresCompletion: true,
      requiresSignature: true,
      startsAt: new Date(),
      dueAt: null,
      expiresAt: null,
      status: true,
      createdBy: params.createdBy,
      updatedBy: params.createdBy,
    },
    { transaction: params.transaction },
  );
  await receipt.update({ requiredActionId: action.id }, { transaction: params.transaction });
  return receipt;
}

export async function getStaffPayoutReceiptActionPayload(params: {
  receiptId: number;
  actionId: number;
  staffUserId: number;
}): Promise<StaffPayoutReceiptActionPayload | null> {
  const receipt = await StaffPayoutReceipt.findOne({
    where: {
      id: params.receiptId,
      requiredActionId: params.actionId,
      staffUserId: params.staffUserId,
      status: 'pending',
    },
    include: [{ model: StaffPayoutReceiptItem, as: 'items' }],
    order: [[{ model: StaffPayoutReceiptItem, as: 'items' }, 'id', 'ASC']],
  });
  return receipt ? buildReceiptActionPayload(receipt) : null;
}

const loadReceiptForConfirmation = async (receiptId: number): Promise<StaffPayoutReceipt | null> =>
  StaffPayoutReceipt.findByPk(receiptId, {
    include: [{ model: StaffPayoutReceiptItem, as: 'items' }],
    order: [[{ model: StaffPayoutReceiptItem, as: 'items' }, 'id', 'ASC']],
  });

export async function confirmStaffPayoutReceipt(params: {
  receiptId: number;
  actionId: number;
  actorId: number;
  photo: Express.Multer.File | undefined;
  signature: unknown;
  acknowledgedAmount: unknown;
  acknowledgedAt: unknown;
  confirmationIp: string | null;
  confirmationUserAgent: string | null;
}): Promise<StaffPayoutReceiptActionPayload> {
  const receipt = await loadReceiptForConfirmation(params.receiptId);
  if (!receipt) {
    throw new Error('Payout receipt request was not found.');
  }
  assertStaffPayoutReceiptActor({
    staffUserId: receipt.staffUserId,
    requiredActionId: receipt.requiredActionId,
    actorId: params.actorId,
    actionId: params.actionId,
  });
  if (receipt.status === 'cancelled') {
    throw new Error('This payout receipt request was cancelled.');
  }
  const payload = buildReceiptActionPayload(receipt);
  if (receipt.status === 'completed') {
    return payload;
  }
  assertStaffPayoutAcknowledgedAmount(params.acknowledgedAmount, payload.amountMinor);
  const photo = validateStaffPayoutReceiptPhoto(params.photo);
  const signatureBuffer = decodeStaffPayoutSignatureDataUrl(params.signature);
  const parsedClientAcknowledgedAt =
    typeof params.acknowledgedAt === 'string' && !Number.isNaN(new Date(params.acknowledgedAt).getTime())
      ? new Date(params.acknowledgedAt)
      : null;

  let photoFile: FinanceFile | null = null;
  let signatureFile: FinanceFile | null = null;
  try {
    photoFile = await storeStaffPayoutReceiptFile({
      receiptId: receipt.id,
      staffUserId: receipt.staffUserId,
      paidDate: receipt.paidDate,
      kind: 'photo',
      originalName: photo.originalname || 'payment-evidence.jpg',
      mimeType: photo.mimetype,
      data: photo.buffer,
      uploadedBy: params.actorId,
    });
    signatureFile = await storeStaffPayoutReceiptFile({
      receiptId: receipt.id,
      staffUserId: receipt.staffUserId,
      paidDate: receipt.paidDate,
      kind: 'signature',
      originalName: 'signature.png',
      mimeType: 'image/png',
      data: signatureBuffer,
      uploadedBy: params.actorId,
    });

    const confirmedAt = new Date();
    await sequelize.transaction(async (transaction) => {
      const lockedReceipt = await StaffPayoutReceipt.findByPk(receipt.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedReceipt) {
        throw new Error('Payout receipt request was not found.');
      }
      assertStaffPayoutReceiptActor({
        staffUserId: lockedReceipt.staffUserId,
        requiredActionId: lockedReceipt.requiredActionId,
        actorId: params.actorId,
        actionId: params.actionId,
      });
      if (lockedReceipt.status !== 'pending') {
        throw new Error('This payout receipt request is no longer pending.');
      }

      await lockedReceipt.update(
        {
          status: 'completed',
          photoFileId: photoFile?.id ?? null,
          signatureFileId: signatureFile?.id ?? null,
          confirmedAt,
          confirmedBy: params.actorId,
          confirmationIp: params.confirmationIp?.slice(0, 96) || null,
          confirmationUserAgent: params.confirmationUserAgent?.slice(0, 4000) || null,
          clientAcknowledgedAt: parsedClientAcknowledgedAt,
        },
        { transaction },
      );

      const responseJson = {
        receiptId: lockedReceipt.id,
        acknowledgedAmount: payload.amount,
        acknowledgedAmountMinor: payload.amountMinor,
        currency: payload.currency,
        acceptanceVersion: lockedReceipt.acceptanceVersion,
        acceptanceText: lockedReceipt.acceptanceText,
        photoFileId: photoFile?.id ?? null,
        signatureFileId: signatureFile?.id ?? null,
        confirmedAt: confirmedAt.toISOString(),
        clientAcknowledgedAt: parsedClientAcknowledgedAt?.toISOString() ?? null,
      };
      const completion = await RequiredActionCompletion.findOne({
        where: { requiredActionId: params.actionId, userId: params.actorId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (completion) {
        await completion.update(
          { status: 'completed', completedAt: confirmedAt, responseJson },
          { transaction },
        );
      } else {
        await RequiredActionCompletion.create(
          {
            requiredActionId: params.actionId,
            userId: params.actorId,
            status: 'completed',
            completedAt: confirmedAt,
            responseJson,
          },
          { transaction },
        );
      }
      await RequiredAction.update(
        { status: false, updatedBy: params.actorId },
        { where: { id: params.actionId }, transaction },
      );
    });
  } catch (error) {
    await Promise.all([
      deleteStoredStaffPayoutReceiptFile(photoFile),
      deleteStoredStaffPayoutReceiptFile(signatureFile),
    ]);
    throw error;
  }

  return payload;
}

export async function findActiveStaffPayoutReceiptsByCollectionLogIds(
  collectionLogIds: number[],
  transaction?: SequelizeTransaction,
): Promise<StaffPayoutReceipt[]> {
  if (collectionLogIds.length === 0) {
    return [];
  }
  return StaffPayoutReceipt.findAll({
    where: { status: ['pending', 'completed'] },
    include: [{
      model: StaffPayoutReceiptItem,
      as: 'items',
      required: true,
      where: { collectionLogId: collectionLogIds },
    }],
    transaction,
  });
}
