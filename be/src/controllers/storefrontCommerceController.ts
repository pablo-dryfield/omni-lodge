import type { NextFunction, Request, Response } from 'express';
import type Stripe from 'stripe';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import { getStripeClient, isStripeConfigured } from '../finance/services/stripeClient.js';
import Booking from '../models/Booking.js';
import BookingAddon from '../models/BookingAddon.js';
import Guest from '../models/Guest.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';
import StorefrontPromotion from '../models/StorefrontPromotion.js';
import StorefrontSavedCart from '../models/StorefrontSavedCart.js';
import {
  quoteStorefrontCart,
  STOREFRONT_CURRENCY,
  type StorefrontCartInput,
  type StorefrontQuote,
} from '../services/storefrontCommerceService.js';
import { deliverStorefrontOrderEmails } from '../services/storefrontOrderEmailService.js';
import { findLockedStorefrontOrderWithItems } from '../services/storefrontOrderPersistenceService.js';
import {
  buildStorefrontAddonsSnapshot,
  getStorefrontExperienceStartAt,
  mergeStorefrontAddonsSnapshot,
} from '../services/storefrontBookingProjectionService.js';
import { maybeSendTshirtSizeSelectionEmail } from '../services/bookings/tshirtSizeEmailAutomationService.js';
import { getStorefrontCancellationPolicy } from '../services/storefrontPublicConfigService.js';
import { getConfigValueRaw } from '../services/configService.js';
import {
  addCustomerToSavedCart,
  getUsableSavedCart,
} from '../services/storefrontSavedCartService.js';
import { normalizeStorefrontPhone } from '../services/storefrontPhoneService.js';
import logger from '../utils/logger.js';

type CheckoutCustomer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  countryCode: string | null;
};

const SYSTEM_USER_ID = Number(process.env.STOREFRONT_SYSTEM_USER_ID || 1);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETTLED_PAYMENT_STATUSES = new Set(['paid', 'partial', 'refunded']);

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const text = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const optionalRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseCustomer = (value: unknown): CheckoutCustomer => {
  const customer = optionalRecord(value);
  if (!customer) {
    throw new HttpError(400, 'Customer details are required.');
  }

  const firstName = text(customer.firstName, 100);
  const lastName = text(customer.lastName, 100);
  const email = text(customer.email, 254).toLowerCase();
  const submittedPhone = text(customer.phone, 40) || null;
  const submittedCountryCode = text(customer.countryCode, 2).toUpperCase() || null;

  if (!firstName || !lastName || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'A valid first name, last name, and email are required.');
  }
  if (submittedCountryCode && !/^[A-Z]{2}$/.test(submittedCountryCode)) {
    throw new HttpError(400, 'Country code must be an ISO two-letter code.');
  }

  const { phone, countryCode } = normalizeStorefrontPhone(
    submittedPhone,
    submittedCountryCode,
  );

  return { firstName, lastName, email, phone, countryCode };
};

const getReturnBaseUrl = (request: Request): string => {
  const requested = text(request.body?.returnBaseUrl, 500);
  if (requested) {
    try {
      const url = new URL(requested);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        return url.toString().replace(/\/+$/, '');
      }
    } catch {
      throw new HttpError(400, 'Invalid checkout return URL.');
    }
  }

  const configured = getConfigValueRaw('STOREFRONT_PUBLIC_URL')?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const origin = request.get('origin');
  if (origin) return `${origin.replace(/\/+$/, '')}/store2`;

  return `${request.protocol}://${request.get('host')}/store2`;
};

const serializeQuote = (quote: StorefrontQuote) => ({
  ...quote,
  itemCount: quote.items.reduce((total, item) => total + item.quantity, 0),
});

const serializeOrder = async (order: StorefrontOrder) => {
  const bookings = await Booking.findAll({
    where: { platform: 'omnilodge', platformOrderId: order.publicId },
    attributes: ['id', 'platformBookingId'],
  });
  const bookingIdByPlatformId = new Map(
    bookings.map((booking) => [booking.platformBookingId, Number(booking.id)]),
  );

  return {
    publicId: order.publicId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    addonTotal: Number(order.addonTotal),
    discountTotal: Number(order.discountTotal),
    total: Number(order.total),
    customer: {
      firstName: order.customerFirstName,
      lastName: order.customerLastName,
      email: order.customerEmail,
      phone: order.customerPhone,
      countryCode: order.customerCountryCode,
    },
    items: (order.items || []).map((item) => ({
      bookingId: bookingIdByPlatformId.get(`${order.publicId}-${item.id}`) ?? null,
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      quantity: item.quantity,
      experienceDate: item.experienceDate,
      experienceTime: item.experienceTime,
      unitPrice: Number(item.unitPrice),
      baseTotal: Number(item.baseTotal),
      addonTotal: Number(item.addonTotal),
      total: Number(item.total),
      addons: item.addons,
      options: item.options,
    })),
    paidAt: order.paidAt,
    createdAt: order.createdAt,
  };
};

const paymentIntentId = (session: Stripe.Checkout.Session): string | null =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;

const persistPaidOrder = async (
  publicId: string,
  stripeSession: Stripe.Checkout.Session | null,
): Promise<StorefrontOrder> =>
  sequelize.transaction(async (transaction) => {
    const order = await findLockedStorefrontOrderWithItems(publicId, transaction);
    if (!order) throw new HttpError(404, 'Storefront order not found.');

    const existingBookings = await Booking.findAll({
      where: { platform: 'omnilodge', platformOrderId: order.publicId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingBookings.length > 0) {
      for (const booking of existingBookings) {
        const item = (order.items || []).find(
          (candidate) => `${order.publicId}-${candidate.id}` === booking.platformBookingId,
        );
        if (!item) continue;

        const updates: Record<string, unknown> = {};
        if (!booking.experienceStartAt) {
          const experienceStartAt = getStorefrontExperienceStartAt(item.experienceDate, item.experienceTime);
          if (experienceStartAt) updates.experienceStartAt = experienceStartAt;
        }
        const nextSnapshot = mergeStorefrontAddonsSnapshot(
          booking.addonsSnapshot,
          Array.isArray(item.addons) ? item.addons : [],
          item.options,
          item.quantity,
        );
        if (JSON.stringify(nextSnapshot) !== JSON.stringify(booking.addonsSnapshot)) {
          updates.addonsSnapshot = nextSnapshot;
        }
        if (Object.keys(updates).length > 0) await booking.update(updates, { transaction });
      }
      if (!SETTLED_PAYMENT_STATUSES.has(order.paymentStatus)) {
        await order.update(
          {
            status: 'confirmed',
            paymentStatus: 'paid',
            stripePaymentIntentId: stripeSession ? paymentIntentId(stripeSession) : null,
            paidAt: order.paidAt || new Date(),
          },
          { transaction },
        );
      }
      await StorefrontSavedCart.update(
        { status: 'paid', paidAt: order.paidAt || new Date() },
        { where: { orderId: order.id }, transaction },
      );
      return order;
    }

    const now = new Date();
    await order.update(
      {
        status: 'confirmed',
        paymentStatus: 'paid',
        stripePaymentIntentId: stripeSession ? paymentIntentId(stripeSession) : null,
        paidAt: order.paidAt || now,
      },
      { transaction },
    );
    await StorefrontSavedCart.update(
      { status: 'paid', paidAt: order.paidAt || now },
      { where: { orderId: order.id }, transaction },
    );

    const guest = await Guest.create(
      {
        name: `${order.customerFirstName} ${order.customerLastName}`.trim(),
        email: order.customerEmail,
        phoneNumber: order.customerPhone,
        address: null,
        paymentStatus: 'paid',
        deposit: Number(order.total),
        notes: `Storefront order ${order.publicId}`,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      } as never,
      { transaction },
    );

    const grossBeforeDiscount = Number(order.subtotal) + Number(order.addonTotal);
    const orderDiscount = Number(order.discountTotal);

    for (const item of order.items || []) {
      const itemGross = Number(item.total);
      const allocatedDiscount =
        grossBeforeDiscount > 0 ? roundMoney(orderDiscount * (itemGross / grossBeforeDiscount)) : 0;
      const itemNet = Math.max(0, roundMoney(itemGross - allocatedDiscount));
      const addons = Array.isArray(item.addons) ? item.addons : [];
      const stripePaymentIntentId = stripeSession ? paymentIntentId(stripeSession) : null;
      const bookingNotes = [
        `Storefront order ${order.publicId}`,
        stripePaymentIntentId ? `Stripe payment_intent: ${stripePaymentIntentId}` : null,
        stripeSession ? `Stripe livemode: ${stripeSession.livemode}` : null,
        'Checkout source: storefront',
      ].filter((value): value is string => Boolean(value));

      const booking = await Booking.create(
        {
          platform: 'omnilodge',
          platformBookingId: `${order.publicId}-${item.id}`,
          platformOrderId: order.publicId,
          guestId: guest.id,
          status: 'confirmed',
          statusChangedAt: now,
          paymentStatus: 'paid',
          paymentMethod: stripeSession ? 'stripe' : 'free',
          paymentMethodCountry: order.customerCountryCode,
          utmSource: order.attribution?.utm_source || null,
          utmMedium: order.attribution?.utm_medium || null,
          utmCampaign: order.attribution?.utm_campaign || null,
          experienceDate: item.experienceDate,
          experienceStartAt: getStorefrontExperienceStartAt(item.experienceDate, item.experienceTime),
          productId: item.productId,
          productName: item.productName,
          guestFirstName: order.customerFirstName,
          guestLastName: order.customerLastName,
          guestEmail: order.customerEmail,
          guestPhone: order.customerPhone,
          partySizeTotal: item.quantity,
          partySizeAdults: item.quantity,
          partySizeChildren: 0,
          currency: order.currency,
          baseAmount: itemNet,
          addonsAmount: Number(item.addonTotal),
          discountAmount: allocatedDiscount,
          discountCode: order.discountCode,
          priceGross: itemGross,
          priceNet: itemNet,
          commissionAmount: 0,
          commissionRate: 0,
          addonsSnapshot: buildStorefrontAddonsSnapshot(addons, item.options, item.quantity),
          notes: bookingNotes.join(' | '),
          sourceReceivedAt: now,
          processedAt: now,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        } as never,
        { transaction },
      );

      for (const addon of addons) {
        await BookingAddon.create(
          {
            bookingId: booking.id,
            addonId: Number(addon.addonId) || null,
            platformAddonId: String(addon.addonId || ''),
            platformAddonName: String(addon.name || ''),
            quantity: Number(addon.quantity) || 1,
            unitPrice: String(addon.unitPrice || 0),
            totalPrice: String(addon.total || 0),
            currency: order.currency,
            isIncluded: false,
            metadata: {
              source: 'storefront',
              variants: Array.isArray(addon.variants) ? addon.variants : [],
            },
          } as never,
          { transaction },
        );
      }
    }

    const promotionIds = Array.from(
      new Set(
        [
          ...(Array.isArray(order.metadata?.promotionIds) ? order.metadata.promotionIds : []),
          order.metadata?.promotionId,
        ]
          .map(Number)
          .filter((promotionId) => Number.isInteger(promotionId) && promotionId > 0),
      ),
    );
    if (promotionIds.length > 0) {
      await StorefrontPromotion.increment('redemptionCount', {
        by: 1,
        where: { id: { [Op.in]: promotionIds } },
        transaction,
      });
    }

    return order;
  });

export const fulfillPaidOrder = async (
  publicId: string,
  stripeSession: Stripe.Checkout.Session | null,
): Promise<StorefrontOrder> => {
  const sessionId = stripeSession?.id || 'none';
  logger.info(`[storefront-fulfillment] Started order=${publicId} session=${sessionId}`);

  let order: StorefrontOrder;
  try {
    order = await persistPaidOrder(publicId, stripeSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `[storefront-fulfillment] Failed order=${publicId} session=${sessionId} error=${message}`,
    );
    throw error;
  }

  try {
    await deliverStorefrontOrderEmails(publicId);
  } catch (error) {
    // Payment fulfillment must remain successful even when Gmail is temporarily unavailable.
    // A later Stripe retry/browser confirmation will resume only the unsent recipient.
    logger.error(`[storefront-email] Delivery failed for paid order ${publicId}: ${(error as Error).message}`);
  }
  try {
    const bookings = await Booking.findAll({ where: { platformOrderId: publicId }, attributes: ['id'] });
    for (const booking of bookings) {
      await maybeSendTshirtSizeSelectionEmail(booking.id);
    }
  } catch (error) {
    logger.error(`[storefront-email] T-shirt size automation failed for paid order ${publicId}: ${(error as Error).message}`);
  }
  logger.info(`[storefront-fulfillment] Completed order=${publicId} session=${sessionId}`);
  return order;
};

export const getStorefrontConfig = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    response.json({
      currency: STOREFRONT_CURRENCY,
      stripeConfigured: isStripeConfigured(),
      checkoutEnabled: isStripeConfigured(),
      cancellationPolicy: getStorefrontCancellationPolicy(),
    });
  } catch (error) {
    next(error);
  }
};

export const quoteCart = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const sharedCartPublicId = text(request.body?.sharedCartPublicId, 36);
    const cart = sharedCartPublicId
      ? (await getUsableSavedCart(sharedCartPublicId)).cart
      : request.body as StorefrontCartInput;
    const quote = await quoteStorefrontCart(
      cart,
      undefined,
      sharedCartPublicId ? { allowMissingCustomerDetails: true } : {},
    );
    response.json(serializeQuote(quote));
  } catch (error) {
    next(error);
  }
};

export const createCheckout = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const customer = parseCustomer(request.body?.customer);
    const attribution = optionalRecord(request.body?.attribution);
    const sharedCartPublicId = text(request.body?.sharedCartPublicId, 36);
    const savedCart = sharedCartPublicId
      ? await getUsableSavedCart(sharedCartPublicId)
      : null;
    const cart = savedCart
      ? addCustomerToSavedCart(savedCart.cart, customer)
      : request.body?.cart as StorefrontCartInput;
    const quote = await quoteStorefrontCart(cart);

    let existingOrder = savedCart?.orderId
      ? await StorefrontOrder.findByPk(savedCart.orderId)
      : null;
    if (existingOrder?.paymentStatus === 'paid') {
      await savedCart?.update({ status: 'paid', paidAt: existingOrder.paidAt || new Date() });
      throw new HttpError(409, 'This prepared cart has already been paid.');
    }

    if (existingOrder?.stripeCheckoutSessionId && isStripeConfigured()) {
      const existingSession = await getStripeClient().checkout.sessions.retrieve(
        existingOrder.stripeCheckoutSessionId,
      );
      const totalsMatch = roundMoney(Number(existingOrder.total)) === roundMoney(quote.total);
      if (existingSession.status === 'open' && existingSession.url && totalsMatch) {
        response.status(200).json({
          publicId: existingOrder.publicId,
          checkoutUrl: existingSession.url,
          quote: serializeQuote(quote),
        });
        return;
      }
      if (existingSession.status === 'complete') {
        throw new HttpError(409, 'Payment has already been submitted and is being confirmed.');
      }
      if (existingSession.status === 'open') {
        await getStripeClient().checkout.sessions.expire(existingSession.id);
      }
    }

    const order = await sequelize.transaction(async (transaction) => {
      const lockedSavedCart = savedCart
        ? await getUsableSavedCart(savedCart.publicId, transaction, true)
        : null;
      if (lockedSavedCart?.orderId && lockedSavedCart.orderId !== existingOrder?.id) {
        throw new HttpError(409, 'Checkout is already being prepared. Please try the link again.');
      }

      const orderValues = {
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        stripeCheckoutSessionId: null,
        currency: quote.currency,
        subtotal: quote.subtotal,
        addonTotal: quote.addonTotal,
        discountTotal: quote.discountTotal,
        total: quote.total,
        customerFirstName: customer.firstName,
        customerLastName: customer.lastName,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerCountryCode: customer.countryCode,
        discountCode: quote.discountCode,
        attribution,
        metadata: {
          promotionId: quote.promotionId,
          promotionIds: quote.discounts.map((discount) => discount.promotionId),
          discountCodes: quote.discountCodes,
          discounts: quote.discounts,
          ...(lockedSavedCart ? { savedCartPublicId: lockedSavedCart.publicId } : {}),
        },
      };

      let pendingOrder = existingOrder;
      if (pendingOrder) {
        await pendingOrder.update(orderValues, { transaction });
        await StorefrontOrderItem.destroy({ where: { orderId: pendingOrder.id }, transaction });
      } else {
        pendingOrder = await StorefrontOrder.create(
        {
          ...orderValues,
        } as never,
        { transaction },
      );
      }

      await StorefrontOrderItem.bulkCreate(
        quote.items.map((item) => ({
          orderId: pendingOrder!.id,
          productId: item.productId,
          productName: item.productName,
          productSlug: item.productSlug,
          quantity: item.quantity,
          experienceDate: item.experienceDate,
          experienceTime: item.experienceTime,
          unitPrice: item.unitPrice,
          baseTotal: item.baseTotal,
          addonTotal: item.addonTotal,
          total: item.total,
          addons: item.addons,
          options: item.options,
        })) as never[],
        { transaction },
      );

      if (lockedSavedCart) {
        await lockedSavedCart.update(
          {
            status: 'checkout_started',
            checkoutStartedAt: lockedSavedCart.checkoutStartedAt || new Date(),
            orderId: pendingOrder.id,
            quoteSnapshot: quote,
            currency: quote.currency,
            total: quote.total,
          },
          { transaction },
        );
      }

      existingOrder = pendingOrder;
      return pendingOrder;
    });

    const returnBaseUrl = getReturnBaseUrl(request);
    if (quote.total === 0) {
      await fulfillPaidOrder(order.publicId, null);
      response.status(201).json({
        publicId: order.publicId,
        checkoutUrl: `${returnBaseUrl}/checkout/success?order=${order.publicId}`,
        quote: serializeQuote(quote),
      });
      return;
    }

    if (!isStripeConfigured()) {
      throw new HttpError(503, 'Online checkout is not configured.');
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customer.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: quote.currency.toLowerCase(),
            unit_amount: Math.round(quote.total * 100),
            product_data: {
              name: `Krawl Through Krakow booking (${quote.items.length} experience${quote.items.length === 1 ? '' : 's'})`,
            },
          },
        },
      ],
      metadata: {
        orderPublicId: order.publicId,
        orderId: String(order.id),
      },
      success_url: `${returnBaseUrl}/checkout/success?order=${order.publicId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnBaseUrl}/cart?checkout=cancelled${savedCart ? `&shared=${savedCart.publicId}` : ''}`,
    });

    await order.update({ stripeCheckoutSessionId: session.id });
    response.status(201).json({
      publicId: order.publicId,
      checkoutUrl: session.url,
      quote: serializeQuote(quote),
    });
  } catch (error) {
    next(error);
  }
};

export const confirmCheckout = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const publicId = text(request.params.publicId, 100);
    const sessionId = text(request.body?.sessionId, 255);
    const order = await StorefrontOrder.findOne({ where: { publicId } });
    if (!order) throw new HttpError(404, 'Storefront order not found.');

    if (order.paymentStatus === 'paid') {
      // The webhook may have committed the booking before its email attempt completed.
      // Re-entering fulfillment is idempotent and resumes only unsent messages.
      await fulfillPaidOrder(publicId, null);
      const hydrated = await StorefrontOrder.findOne({
        where: { publicId },
        include: [{ model: StorefrontOrderItem, as: 'items' }],
      });
      response.json(await serializeOrder(hydrated!));
      return;
    }
    if (!sessionId || sessionId !== order.stripeCheckoutSessionId) {
      throw new HttpError(400, 'Invalid checkout session.');
    }

    const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.orderPublicId !== publicId || session.payment_status !== 'paid') {
      throw new HttpError(409, 'Payment has not completed.');
    }

    await fulfillPaidOrder(publicId, session);
    const hydrated = await StorefrontOrder.findOne({
      where: { publicId },
      include: [{ model: StorefrontOrderItem, as: 'items' }],
    });
    response.json(await serializeOrder(hydrated!));
  } catch (error) {
    next(error);
  }
};

export const getOrder = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const order = await StorefrontOrder.findOne({
      where: { publicId: text(request.params.publicId, 100) },
      include: [{ model: StorefrontOrderItem, as: 'items' }],
    });
    if (!order) throw new HttpError(404, 'Storefront order not found.');
    response.json(await serializeOrder(order));
  } catch (error) {
    next(error);
  }
};
