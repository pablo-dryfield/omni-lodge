import type { NextFunction, Request, Response } from 'express';
import type Stripe from 'stripe';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import {
  getStorefrontStripePublishableKey,
  getStorefrontStripeClient,
  isStorefrontStripeConfigured,
} from '../finance/services/stripeClient.js';
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
import { getStorefrontPublicConfig } from '../services/storefrontPublicConfigService.js';
import {
  addCustomerToSavedCart,
  getUsableSavedCart,
} from '../services/storefrontSavedCartService.js';
import {
  getUsableOngoingCart,
  markOngoingCartConverted,
  recordOngoingCartEvent,
  recordOngoingCartEventByIdentity,
  resetOngoingCartCheckoutActivity,
  upsertOngoingCart,
} from '../services/storefrontOngoingCartService.js';
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
  const phone = text(customer.phone, 40) || null;
  const countryCode = text(customer.countryCode, 2).toUpperCase() || null;

  if (!firstName || !lastName || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'A valid first name, last name, and email are required.');
  }
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new HttpError(400, 'Country code must be an ISO two-letter code.');
  }

  return { firstName, lastName, email, phone, countryCode };
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

type StorefrontStripePayment = Stripe.Checkout.Session | Stripe.PaymentIntent;

const paymentIntentId = (payment: StorefrontStripePayment): string | null => {
  if (payment.object === 'payment_intent') return payment.id;
  return typeof payment.payment_intent === 'string'
    ? payment.payment_intent
    : payment.payment_intent?.id || null;
};

const persistPaidOrder = async (
  publicId: string,
  stripePayment: StorefrontStripePayment | null,
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
            stripePaymentIntentId: stripePayment ? paymentIntentId(stripePayment) : order.stripePaymentIntentId,
            paidAt: order.paidAt || new Date(),
          },
          { transaction },
        );
      }
      await StorefrontSavedCart.update(
        { status: 'paid', paidAt: order.paidAt || new Date() },
        { where: { orderId: order.id }, transaction },
      );
      await markOngoingCartConverted(order.id, order.paidAt || new Date(), transaction);
      return order;
    }

    const now = new Date();
    await order.update(
      {
        status: 'confirmed',
        paymentStatus: 'paid',
        stripePaymentIntentId: stripePayment ? paymentIntentId(stripePayment) : order.stripePaymentIntentId,
        paidAt: order.paidAt || now,
      },
      { transaction },
    );
    await StorefrontSavedCart.update(
      { status: 'paid', paidAt: order.paidAt || now },
      { where: { orderId: order.id }, transaction },
    );
    await markOngoingCartConverted(order.id, order.paidAt || now, transaction);

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
      const stripePaymentIntentId = stripePayment ? paymentIntentId(stripePayment) : order.stripePaymentIntentId;
      const bookingNotes = [
        `Storefront order ${order.publicId}`,
        stripePaymentIntentId ? `Stripe payment_intent: ${stripePaymentIntentId}` : null,
        stripePayment ? `Stripe livemode: ${stripePayment.livemode}` : null,
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
          paymentMethod: stripePayment ? 'stripe' : 'free',
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
  stripePayment: StorefrontStripePayment | null,
): Promise<StorefrontOrder> => {
  const paymentId = stripePayment?.id || 'none';
  logger.info(`[storefront-fulfillment] Started order=${publicId} payment=${paymentId}`);

  let order: StorefrontOrder;
  try {
    order = await persistPaidOrder(publicId, stripePayment);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `[storefront-fulfillment] Failed order=${publicId} payment=${paymentId} error=${message}`,
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
  logger.info(`[storefront-fulfillment] Completed order=${publicId} payment=${paymentId}`);
  return order;
};

export const getStorefrontConfig = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    response.json(getStorefrontPublicConfig());
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
    const cartSessionId = text(request.body?.cartSessionId, 36);
    const ongoing = !sharedCartPublicId && cartSessionId
      ? await upsertOngoingCart({
          sessionId: cartSessionId,
          publicId: request.body?.ongoingCartPublicId,
          cart,
          customer: request.body?.customer,
          attribution: request.body?.attribution,
          quote,
        })
      : null;
    const clientEvent = optionalRecord(request.body?.clientEvent);
    if (ongoing && clientEvent?.type === 'checkout_cancelled') {
      const cancelledOrder = text(clientEvent.orderPublicId, 36);
      await recordOngoingCartEvent(ongoing, {
        type: 'checkout_cancelled',
        severity: 'warning',
        message: 'Customer returned from Stripe without completing payment.',
        details: cancelledOrder ? { orderPublicId: cancelledOrder } : null,
        dedupeKey: `checkout_cancelled:${cancelledOrder || ongoing.orderId || 'unknown'}`,
      });
    } else if (ongoing && clientEvent?.type === 'payment_error') {
      const clientEventId = text(clientEvent.id, 100);
      const orderPublicId = text(clientEvent.orderPublicId, 36);
      const errorType = text(clientEvent.errorType, 64);
      const code = text(clientEvent.code, 100);
      await recordOngoingCartEvent(ongoing, {
        type: 'payment_error',
        severity: 'error',
        message: text(clientEvent.message, 500) || 'The payment form reported an error.',
        details: {
          ...(orderPublicId ? { orderPublicId } : {}),
          ...(errorType ? { errorType } : {}),
          ...(code ? { code } : {}),
        },
        ...(clientEventId ? { dedupeKey: `client:${clientEventId}` } : {}),
      });
    }
    response.json({
      ...serializeQuote(quote),
      ongoingCart: ongoing ? {
        publicId: ongoing.publicId,
        sessionId: ongoing.sessionId,
        status: ongoing.status,
        recoveryDueAt: ongoing.recoveryDueAt,
      } : null,
    });
  } catch (error) {
    await recordOngoingCartEventByIdentity(
      { publicId: request.body?.ongoingCartPublicId, sessionId: request.body?.cartSessionId },
      {
        type: 'quote_error',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Unable to calculate the cart total.',
        details: error instanceof HttpError ? { status: error.status } : null,
      },
    );
    next(error);
  }
};

export const createCheckout = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const customer = parseCustomer(request.body?.customer);
    const attribution = optionalRecord(request.body?.attribution);
    const sharedCartPublicId = text(request.body?.sharedCartPublicId, 36);
    const ongoingCartPublicId = sharedCartPublicId ? '' : text(request.body?.ongoingCartPublicId, 36);
    const savedCart = sharedCartPublicId
      ? await getUsableSavedCart(sharedCartPublicId)
      : null;
    const ongoingCart = ongoingCartPublicId
      ? await getUsableOngoingCart(ongoingCartPublicId)
      : null;
    const cart = savedCart
      ? addCustomerToSavedCart(savedCart.cart, customer)
      : request.body?.cart as StorefrontCartInput;
    const quote = await quoteStorefrontCart(cart);
    const publishableKey = getStorefrontStripePublishableKey();
    const amount = Math.round(quote.total * 100);
    const currency = quote.currency.toLowerCase();

    const existingOrderId = savedCart?.orderId ?? ongoingCart?.orderId;
    let existingOrder = existingOrderId
      ? await StorefrontOrder.findByPk(existingOrderId)
      : null;
    if (existingOrder?.paymentStatus === 'paid') {
      await savedCart?.update({ status: 'paid', paidAt: existingOrder.paidAt || new Date() });
      if (ongoingCart) {
        await markOngoingCartConverted(existingOrder.id, existingOrder.paidAt || new Date());
      }
      throw new HttpError(409, 'This cart has already been paid.');
    }

    if (existingOrder?.stripeCheckoutSessionId && isStorefrontStripeConfigured()) {
      const existingSession = await getStorefrontStripeClient().checkout.sessions.retrieve(
        existingOrder.stripeCheckoutSessionId,
      );
      if (existingSession.status === 'complete' && existingSession.payment_status === 'paid') {
        await fulfillPaidOrder(existingOrder.publicId, existingSession);
        response.status(200).json({
          publicId: existingOrder.publicId,
          paymentComplete: true,
          quote: serializeQuote(quote),
        });
        return;
      }
      if (existingSession.status === 'complete') {
        throw new HttpError(409, 'Payment has already been submitted and is being confirmed.');
      }
      if (existingSession.status === 'open') {
        await getStorefrontStripeClient().checkout.sessions.update(existingSession.id, {
          metadata: { ...existingSession.metadata, ktkReplaced: 'true' },
        });
        await getStorefrontStripeClient().checkout.sessions.expire(existingSession.id);
      }
    }

    let reusablePaymentIntent: Stripe.PaymentIntent | null = null;
    if (existingOrder?.stripePaymentIntentId && isStorefrontStripeConfigured()) {
      const stripe = getStorefrontStripeClient();
      const existingPaymentIntent = await stripe.paymentIntents.retrieve(
        existingOrder.stripePaymentIntentId,
      );
      if (existingPaymentIntent.status === 'succeeded') {
        await fulfillPaidOrder(existingOrder.publicId, existingPaymentIntent);
        response.status(200).json({
          publicId: existingOrder.publicId,
          paymentComplete: true,
          paymentIntentId: existingPaymentIntent.id,
          quote: serializeQuote(quote),
        });
        return;
      }
      if (
        existingPaymentIntent.status === 'processing'
        || existingPaymentIntent.status === 'requires_capture'
        || existingPaymentIntent.status === 'requires_action'
      ) {
        throw new HttpError(409, 'Payment has already been submitted and is being confirmed.');
      }

      const totalsMatch = existingPaymentIntent.amount === amount
        && existingPaymentIntent.currency === currency;
      if ((!totalsMatch || amount === 0) && existingPaymentIntent.status !== 'canceled') {
        await stripe.paymentIntents.update(existingPaymentIntent.id, {
          metadata: { ...existingPaymentIntent.metadata, ktkReplaced: 'true' },
        });
        await stripe.paymentIntents.cancel(existingPaymentIntent.id, {
          cancellation_reason: 'abandoned',
        });
      } else if (existingPaymentIntent.status !== 'canceled') {
        reusablePaymentIntent = existingPaymentIntent;
      }
    }

    const order = await sequelize.transaction(async (transaction) => {
      const lockedSavedCart = savedCart
        ? await getUsableSavedCart(savedCart.publicId, transaction, true)
        : null;
      const lockedOngoingCart = ongoingCart
        ? await getUsableOngoingCart(ongoingCart.publicId, transaction, true)
        : null;
      if (lockedSavedCart?.orderId && lockedSavedCart.orderId !== existingOrder?.id) {
        throw new HttpError(409, 'Checkout is already being prepared. Please try the link again.');
      }
      if (lockedOngoingCart?.orderId && lockedOngoingCart.orderId !== existingOrder?.id) {
        throw new HttpError(409, 'Checkout is already being prepared. Please try again.');
      }

      const orderValues = {
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: reusablePaymentIntent?.id || null,
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
          ...(lockedOngoingCart ? { ongoingCartPublicId: lockedOngoingCart.publicId } : {}),
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
      if (lockedOngoingCart) {
        await resetOngoingCartCheckoutActivity(lockedOngoingCart, quote, pendingOrder.id, transaction);
      }

      existingOrder = pendingOrder;
      return pendingOrder;
    });

    if (quote.total === 0) {
      await fulfillPaidOrder(order.publicId, null);
      response.status(201).json({
        publicId: order.publicId,
        paymentComplete: true,
        quote: serializeQuote(quote),
      });
      return;
    }

    if (!isStorefrontStripeConfigured()) {
      throw new HttpError(503, 'Online checkout is not configured.');
    }
    if (!publishableKey) {
      throw new HttpError(503, 'The Stripe publishable key is not configured for this environment.');
    }

    const stripe = getStorefrontStripeClient();
    const stripeMetadata = {
      orderPublicId: order.publicId,
      orderId: String(order.id),
      ...(ongoingCart ? { ongoingCartPublicId: ongoingCart.publicId } : {}),
    };
    let paymentIntent: Stripe.PaymentIntent | null = null;
    if (reusablePaymentIntent) {
      paymentIntent = await stripe.paymentIntents.update(reusablePaymentIntent.id, {
        receipt_email: customer.email,
        metadata: stripeMetadata,
      });
    }

    paymentIntent ??= await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      receipt_email: customer.email,
      description: `Krawl Through Krakow booking ${order.publicId}`,
      metadata: stripeMetadata,
    });
    if (!paymentIntent.client_secret) {
      throw new HttpError(502, 'Stripe did not return a payment client secret.');
    }

    await order.update({
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: paymentIntent.id,
    });
    if (ongoingCart) {
      await recordOngoingCartEvent(ongoingCart, {
        type: 'checkout_started',
        severity: 'info',
        message: 'Customer opened the Stripe payment form.',
        details: { orderPublicId: order.publicId, paymentIntentId: paymentIntent.id },
      });
    }
    response.status(201).json({
      publicId: order.publicId,
      paymentMode: 'payment_element',
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      publishableKey,
      quote: serializeQuote(quote),
    });
  } catch (error) {
    await recordOngoingCartEventByIdentity(
      { publicId: request.body?.ongoingCartPublicId },
      {
        type: 'checkout_error',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Unable to start Stripe checkout.',
        details: error instanceof HttpError ? { status: error.status } : null,
      },
    );
    next(error);
  }
};

export const confirmCheckout = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const publicId = text(request.params.publicId, 100);
    const requestedPaymentIntentId = text(request.body?.paymentIntentId, 255);
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

    let paymentComplete = false;
    if (requestedPaymentIntentId) {
      if (requestedPaymentIntentId !== order.stripePaymentIntentId) {
        throw new HttpError(400, 'Invalid payment intent.');
      }
      const paymentIntent = await getStorefrontStripeClient().paymentIntents.retrieve(
        requestedPaymentIntentId,
      );
      if (paymentIntent.metadata?.orderPublicId !== publicId) {
        throw new HttpError(400, 'Invalid payment intent.');
      }
      paymentComplete = paymentIntent.status === 'succeeded';
      if (paymentComplete) await fulfillPaidOrder(publicId, paymentIntent);
      if (
        !paymentComplete
        && (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled')
      ) {
        throw new HttpError(409, 'Payment was not completed. Return to your cart and try again.');
      }
    } else {
      if (!sessionId || sessionId !== order.stripeCheckoutSessionId) {
        throw new HttpError(400, 'Invalid checkout confirmation.');
      }
      const session = await getStorefrontStripeClient().checkout.sessions.retrieve(sessionId);
      if (session.metadata?.orderPublicId !== publicId) {
        throw new HttpError(400, 'Invalid checkout session.');
      }
      paymentComplete = session.payment_status === 'paid';
      if (paymentComplete) await fulfillPaidOrder(publicId, session);
    }

    const hydrated = await StorefrontOrder.findOne({
      where: { publicId },
      include: [{ model: StorefrontOrderItem, as: 'items' }],
    });
    response.status(paymentComplete ? 200 : 202).json(await serializeOrder(hydrated!));
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
