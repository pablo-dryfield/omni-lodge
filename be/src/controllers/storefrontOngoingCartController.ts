import type { NextFunction, Request, Response } from 'express';
import { Op } from 'sequelize';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  ONGOING_CART_STATUSES,
  getUsableOngoingCart,
  parseStorefrontUuid,
  serializeOngoingCart,
} from '../services/storefrontOngoingCartService.js';
import { quoteStorefrontCart } from '../services/storefrontCommerceService.js';
import {
  buildStorefrontCartRecoveryEmail,
  ensureStorefrontCartRecoveryToken,
  sendAndRecordStorefrontCartRecoveryEmail,
} from '../services/storefrontCartRecoveryEmailService.js';
import HttpError from '../errors/HttpError.js';

export const dismissOngoingCartBySession = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const sessionId = parseStorefrontUuid(request.params.sessionId, 'Cart session ID');
    const now = new Date();
    await StorefrontOngoingCart.update(
      { status: 'dismissed', dismissedAt: now },
      { where: { sessionId, status: { [Op.in]: [...ONGOING_CART_STATUSES] } } },
    );
    response.json({ dismissed: true });
  } catch (error) {
    next(error);
  }
};

export const recoverOngoingCart = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const ongoing = await getUsableOngoingCart(request.params.publicId);
    const quote = await quoteStorefrontCart(ongoing.cart);
    const recoveryToken = String(request.query.rt ?? '').trim();
    const trackedRecoveryOpen = Boolean(
      recoveryToken
      && ongoing.recoveryToken
      && ongoing.firstRecoverySentAt
      && recoveryToken === ongoing.recoveryToken,
    );
    await ongoing.update({
      openedAt: ongoing.openedAt || new Date(),
      ...(trackedRecoveryOpen && !ongoing.recoveryOpenedAt ? { recoveryOpenedAt: new Date() } : {}),
      quoteSnapshot: quote,
      currency: quote.currency,
      total: quote.total,
    });
    response.json({ ongoingCart: serializeOngoingCart(ongoing) });
  } catch (error) {
    next(error);
  }
};

const serializeRowsWithOrders = async (rows: StorefrontOngoingCart[]) => {
  const orderIds = rows.map((row) => row.orderId).filter((id): id is number => id !== null);
  const orders = orderIds.length
    ? await StorefrontOrder.findAll({ where: { id: { [Op.in]: orderIds } }, attributes: ['id', 'publicId'] })
    : [];
  const orderPublicIds = new Map(orders.map((order) => [Number(order.id), order.publicId]));
  return rows.map((row) => serializeOngoingCart(
    row,
    row.orderId ? orderPublicIds.get(Number(row.orderId)) ?? null : null,
  ));
};

export const listOngoingCarts = async (
  _request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const rows = await StorefrontOngoingCart.findAll({
      where: { status: { [Op.in]: [...ONGOING_CART_STATUSES] } },
      order: [['lastActivityAt', 'DESC']],
      limit: 250,
    });
    response.json({ data: await serializeRowsWithOrders(rows) });
  } catch (error) {
    next(error);
  }
};

export const listRecoveredCarts = async (
  _request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const rows = await StorefrontOngoingCart.findAll({
      where: { status: 'converted', recoveredAt: { [Op.ne]: null } },
      order: [['recoveredAt', 'DESC']],
      limit: 250,
    });
    response.json({ data: await serializeRowsWithOrders(rows) });
  } catch (error) {
    next(error);
  }
};

export const sendOngoingCartRecoveryEmail = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const ongoing = await getUsableOngoingCart(request.params.publicId);
    const previousStatus = ongoing.status;
    const [claimed] = await StorefrontOngoingCart.update(
      { status: 'sending_recovery' },
      {
        where: {
          id: ongoing.id,
          status: { [Op.in]: ['active', 'checkout_started', 'recovery_sent'] },
        },
      },
    );
    if (!claimed) throw new HttpError(409, 'A recovery email is already being sent for this cart.');

    try {
      await sendAndRecordStorefrontCartRecoveryEmail(ongoing);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await StorefrontOngoingCart.update(
        { status: previousStatus, recoveryError: message.slice(0, 2000) },
        { where: { id: ongoing.id, status: 'sending_recovery' } },
      );
      throw error;
    }

    response.json({ data: serializeOngoingCart(ongoing) });
  } catch (error) {
    next(error);
  }
};

export const previewOngoingCartRecoveryEmail = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const ongoing = await getUsableOngoingCart(request.params.publicId);
    await ensureStorefrontCartRecoveryToken(ongoing);
    const preview = buildStorefrontCartRecoveryEmail(ongoing);
    response.json({
      data: {
        to: ongoing.customer.email,
        subject: preview.subject,
        htmlBody: preview.htmlBody,
        textBody: preview.textBody,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const dismissOngoingCart = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const ongoing = await getUsableOngoingCart(request.params.publicId);
    await ongoing.update({ status: 'dismissed', dismissedAt: new Date() });
    response.json({ data: serializeOngoingCart(ongoing) });
  } catch (error) {
    next(error);
  }
};
