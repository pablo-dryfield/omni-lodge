import type { NextFunction, Request, Response } from 'express';
import { Op } from 'sequelize';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontPromotion from '../models/StorefrontPromotion.js';
import sequelize from '../config/database.js';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  ONGOING_CART_STATUSES,
  getUsableOngoingCart,
  parseStorefrontUuid,
  serializeOngoingCart,
} from '../services/storefrontOngoingCartService.js';
import { quoteStorefrontCart } from '../services/storefrontCommerceService.js';
import {
  prepareStorefrontCartRecoveryEmail,
  ensureStorefrontCartRecoveryToken,
  refreshDuplicateRecoveryCart,
  sendAndRecordStorefrontCartRecoveryEmail,
} from '../services/storefrontCartRecoveryEmailService.js';
import HttpError from '../errors/HttpError.js';
import { getRecoveryCouponOptions, parseRecoveryOfferOverride, recoveredCartWithOffer } from '../services/storefrontRecoveryOfferService.js';
import { listOngoingCartPage } from '../services/storefrontOngoingCartListService.js';
import {
  getOngoingCartJourney,
  ingestClientJourneyEvents,
} from '../services/storefrontJourneyService.js';

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
    const baseline = await quoteStorefrontCart(ongoing.cart);
    const recoveryToken = String(request.query.rt ?? '').trim();
    const recovered = await recoveredCartWithOffer(ongoing, recoveryToken, baseline);
    const trackedRecoveryOpen = Boolean(
      recoveryToken
      && ongoing.recoveryToken
      && ongoing.firstRecoverySentAt
      && recoveryToken.split('.')[0] === ongoing.recoveryToken,
    );
    await ongoing.update({
      openedAt: ongoing.openedAt || new Date(),
      ...(trackedRecoveryOpen && !ongoing.recoveryOpenedAt ? { recoveryOpenedAt: new Date() } : {}),
    });
    // Opening a recovery link must not overwrite a concurrent save from another device.
    // Persist the normalized selection only through the version-checked quote/save path.
    response.json({ ongoingCart: { ...serializeOngoingCart(ongoing, null, { includeRecoveryOfferAudit: false }), cart: recovered.cart,
      quote: recovered.quote, currency: recovered.quote.currency, total: recovered.quote.total } });
  } catch (error) {
    next(error);
  }
};

export const recordOngoingCartActivity = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const ongoing = await getUsableOngoingCart(request.params.publicId);
    const journey = await ingestClientJourneyEvents(
      ongoing,
      request.body?.journeyEvents,
      request.body?.clientContext,
    );
    response.status(202).json({ journey });
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
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { rows, ...page } = await listOngoingCartPage(request.query);
    const data = (await serializeRowsWithOrders(rows)).map(cart => ({
      publicId: cart.publicId, status: cart.status, customer: cart.customer, quote: { items: cart.quote.items },
      total: cart.total, currency: cart.currency, lastActivityAt: cart.lastActivityAt, recoveryDueAt: cart.recoveryDueAt,
      recoverySentAt: cart.recoverySentAt, firstRecoverySentAt: cart.firstRecoverySentAt, lastRecoverySentAt: cart.lastRecoverySentAt,
      recoveryOpenedAt: cart.recoveryOpenedAt, recoveredAt: cart.recoveredAt, recoveryCount: cart.recoveryCount,
      createdAt: cart.createdAt, orderPublicId: cart.orderPublicId, events: cart.events.slice(0, 1),
      identityReview: cart.identityReview,
    }));
    response.json({ data, ...page });
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

export const getOngoingCartActivity = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const publicId = parseStorefrontUuid(request.params.publicId, 'Ongoing cart ID');
    const ongoing = await StorefrontOngoingCart.findOne({ where: { publicId } });
    if (!ongoing) throw new HttpError(404, 'Ongoing cart not found.');
    const mergedIds = Array.isArray(ongoing.metadata?.mergedCartIds)
      ? ongoing.metadata.mergedCartIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id !== Number(ongoing.id)) : [];
    const merged = mergedIds.length ? await StorefrontOngoingCart.findAll({ where: { id: { [Op.in]: mergedIds } } }) : [];
    const records = [ongoing, ...merged];
    const visits = (await Promise.all(records.map(cart => getOngoingCartJourney(cart.id)))).flat();
    response.json({
      data: {
        publicId: ongoing.publicId,
        visits: visits.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
        legacyEvents: records.flatMap(cart => serializeOngoingCart(cart).events).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      },
    });
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
      const version = request.body?.previewVersion;
      if (version !== undefined && (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version))) throw new HttpError(400, 'Invalid recovery preview version.');
      await sendAndRecordStorefrontCartRecoveryEmail(ongoing, version);
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
    await refreshDuplicateRecoveryCart(ongoing);
    await ensureStorefrontCartRecoveryToken(ongoing);
    const prepared = await prepareStorefrontCartRecoveryEmail(ongoing);
    const preview = prepared.email;
    const canEditOffer = ['admin', 'owner', 'manager'].includes(request.authContext?.roleSlug ?? '');
    response.json({
      data: {
        to: ongoing.customer.email,
        subject: preview.subject,
        htmlBody: preview.htmlBody,
        textBody: preview.textBody,
        previewVersion: prepared.previewVersion,
        recoveryOffer: {
          override: prepared.override, groupSize: prepared.groupSize, guestCountMode: prepared.guestCountMode,
          offer: prepared.offer, warnings: prepared.warnings, canEdit: canEditOffer,
          error: prepared.error,
          couponOptions: canEditOffer ? await getRecoveryCouponOptions() : [],
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listRecoveryCoupons = async (_request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> => {
  try { response.json({ data: await getRecoveryCouponOptions() }); } catch (error) { next(error); }
};

export const updateCartRecoveryOffer = async (request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> => {
  try {
    const publicId = parseStorefrontUuid(request.params.publicId, 'Ongoing cart ID');
    const override = parseRecoveryOfferOverride(request.body);
    const actorId = request.authContext?.id;
    if (!actorId) throw new HttpError(403, 'An authenticated manager is required.');
    if (override.mode === 'coupon') {
      const promotion = await StorefrontPromotion.findByPk(override.promotionId!);
      if (!promotion || !promotion.isActive) throw new HttpError(400, 'Choose an existing active coupon.');
    }
    const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 500) : null;
    await sequelize.transaction(async transaction => {
      const row = await StorefrontOngoingCart.findOne({ where: { publicId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw new HttpError(404, 'Ongoing cart not found.');
      if (!['active', 'checkout_started', 'recovery_sent'].includes(row.status)) throw new HttpError(409, 'This cart cannot be edited while sending or after payment.');
      const metadata = row.metadata ?? {};
      const recorded = { ...override, actorId, reason, updatedAt: new Date().toISOString() };
      await row.update({ metadata: {
        ...metadata, recoveryOfferOverride: recorded,
        events: [...(Array.isArray(metadata.events) ? metadata.events : []), {
          id: randomUUID(), occurredAt: recorded.updatedAt, type: 'recovery_offer_updated', severity: 'info',
          message: 'Recovery email offer settings updated by a manager.',
          details: { actorId, reason, previous: metadata.recoveryOfferOverride ?? null, current: recorded },
        }],
      } }, { transaction });
    });
    response.json({ data: { override } });
  } catch (error) { next(error); }
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
