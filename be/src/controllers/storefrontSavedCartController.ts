import dayjs from 'dayjs';
import type { NextFunction, Response } from 'express';
import { Op } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontSavedCart from '../models/StorefrontSavedCart.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { quoteStorefrontCart, type StorefrontCartInput } from '../services/storefrontCommerceService.js';
import {
  expireSavedCarts,
  getUsableSavedCart,
  normalizeSavedCartCustomer,
  normalizeSavedCartFromQuote,
  savedCartStatus,
} from '../services/storefrontSavedCartService.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const publicId = (value: unknown): string => {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new HttpError(400, 'Prepared cart ID is invalid.');
  return normalized;
};

const expirationDate = (body: Record<string, unknown>): Date => {
  if (body.expiresAt) {
    const parsed = new Date(String(body.expiresAt));
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new HttpError(400, 'Expiration must be in the future.');
    }
    if (parsed.getTime() > dayjs().add(90, 'day').valueOf()) {
      throw new HttpError(400, 'Prepared carts cannot remain active for more than 90 days.');
    }
    return parsed;
  }
  const days = Math.floor(Number(body.expiresInDays ?? 7));
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new HttpError(400, 'Expiration must be between 1 and 90 days.');
  }
  return dayjs().add(days, 'day').toDate();
};

const serialize = (savedCart: StorefrontSavedCart, orderPublicId: string | null = null) => ({
  id: savedCart.id,
  publicId: savedCart.publicId,
  name: savedCart.name,
  status: savedCartStatus(savedCart),
  cart: savedCart.cart,
  customer: savedCart.customer,
  quote: savedCart.quoteSnapshot,
  currency: savedCart.currency,
  total: Number(savedCart.total),
  locked: savedCart.isLocked,
  expiresAt: savedCart.expiresAt,
  openedAt: savedCart.openedAt,
  checkoutStartedAt: savedCart.checkoutStartedAt,
  paidAt: savedCart.paidAt,
  disabledAt: savedCart.disabledAt,
  orderId: savedCart.orderId,
  orderPublicId,
  createdByUserId: savedCart.createdByUserId,
  createdAt: savedCart.createdAt,
  updatedAt: savedCart.updatedAt,
});

const quoteInput = async (value: unknown) => {
  const quote = await quoteStorefrontCart(value as StorefrontCartInput, undefined, {
    allowMissingCustomerDetails: true,
  });
  return { quote, cart: normalizeSavedCartFromQuote(quote) };
};

export const previewSavedCart = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await quoteInput(request.body?.cart);
    response.json(result);
  } catch (error) {
    next(error);
  }
};

export const createSavedCart = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = request.authContext?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized.');
    const { quote, cart } = await quoteInput(request.body?.cart);
    const customer = normalizeSavedCartCustomer(request.body?.customer);
    const defaultName = customer?.fullName || quote.items.map((item) => item.productName).join(' + ');
    const name = String(request.body?.name ?? defaultName).trim().slice(0, 160);
    if (!name) throw new HttpError(400, 'A prepared cart name is required.');

    const savedCart = await StorefrontSavedCart.create({
      name,
      status: 'active',
      cart,
      customer,
      quoteSnapshot: quote,
      currency: quote.currency,
      total: quote.total,
      isLocked: true,
      expiresAt: expirationDate(request.body ?? {}),
      createdByUserId: userId,
      metadata: { initialTotal: quote.total },
    });
    response.status(201).json({ data: serialize(savedCart) });
  } catch (error) {
    next(error);
  }
};

export const listSavedCarts = async (
  _request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await expireSavedCarts();
    const rows = await StorefrontSavedCart.findAll({ order: [['createdAt', 'DESC']], limit: 250 });
    const orderIds = rows.map((row) => row.orderId).filter((id): id is number => id !== null);
    const orders = orderIds.length
      ? await StorefrontOrder.findAll({ where: { id: { [Op.in]: orderIds } }, attributes: ['id', 'publicId'] })
      : [];
    const orderPublicIds = new Map(orders.map((order) => [Number(order.id), order.publicId]));
    response.json({
      data: rows.map((row) => serialize(row, row.orderId ? orderPublicIds.get(Number(row.orderId)) ?? null : null)),
    });
  } catch (error) {
    next(error);
  }
};

export const disableSavedCart = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const savedCart = await StorefrontSavedCart.findOne({ where: { publicId: publicId(request.params.publicId) } });
    if (!savedCart) throw new HttpError(404, 'Prepared cart not found.');
    if (savedCart.status === 'paid') throw new HttpError(409, 'A paid cart cannot be disabled.');
    await savedCart.update({ status: 'disabled', disabledAt: new Date() });
    response.json({ data: serialize(savedCart) });
  } catch (error) {
    next(error);
  }
};

export const getPublicSavedCart = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const savedCart = await getUsableSavedCart(publicId(request.params.publicId));
    const quote = await quoteStorefrontCart(savedCart.cart, undefined, { allowMissingCustomerDetails: true });
    await savedCart.update({
      openedAt: savedCart.openedAt || new Date(),
      quoteSnapshot: quote,
      currency: quote.currency,
      total: quote.total,
    });
    response.json({
      preparedCart: {
        publicId: savedCart.publicId,
        name: savedCart.name,
        status: savedCartStatus(savedCart),
        cart: savedCart.cart,
        customer: savedCart.customer,
        quote,
        locked: true,
        expiresAt: savedCart.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
