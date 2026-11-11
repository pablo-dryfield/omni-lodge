import Stripe from 'stripe';
import { Op } from 'sequelize';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import User from '../../models/User.js';
import HttpError from '../../errors/HttpError.js';
import { getDirectStripeClient, getStripeClient, normalizeDirectStripeMerchant, type StripeMode } from '../../finance/services/stripeClient.js';
import { getEcwidOrder } from '../ecwidService.js';
import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import { extractDirectStripeMode, extractDirectStripeTransactionId, isStorefrontBooking } from './bookingStripeReference.js';
import type { BookingPaymentDetails, BookingPaymentEvents, PaymentActivity, PaymentHistoryEvent, PaymentItem, PaymentMethodDetails, PaymentRequestReference } from './bookingPaymentTypes.js';

const CONFIG_KEYS = ['BOOKING_PAYMENTS_REQUEST_TIMEOUT_MS', 'BOOKING_PAYMENTS_PAGE_SIZE', 'BOOKING_PAYMENTS_EVENT_SCAN_PAGES'] as const;
// Provider-defined retention and API limits, rather than editable business rules.
const STRIPE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 500): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const id = (value: unknown): string | null => text(typeof value === 'string' ? value : object(value).id, 255);
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const time = (value: unknown): number => { const ms = new Date(value as string | Date).getTime(); return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0; };
const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const bankTransfer = (value: unknown) => ['bank_transfer', 'banktransfer'].includes(normalized(value));
const missing = (error: unknown) => object(error).code === 'resource_missing';
const human = (value: string) => value.replace(/[_.-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

export function paymentReadError(error: unknown): string {
  const e = object(error);
  if (error instanceof HttpError && error.status === 503) return 'Stripe is not configured for this merchant and payment mode. Check Settings / Control Panel.';
  if (e.type === 'StripeAuthenticationError' || e.statusCode === 401) return 'Stripe credentials need attention in Settings / Control Panel.';
  if (e.type === 'StripePermissionError' || e.statusCode === 403) return 'The configured Stripe key does not allow this read operation.';
  if (e.type === 'StripeRateLimitError' || e.statusCode === 429) return 'Stripe is temporarily rate limiting requests. Try again shortly.';
  if (missing(error)) return 'The payment was not found in its configured Stripe account and mode.';
  return 'Stripe information is temporarily unavailable. Retry the refresh or open the payment in Stripe.';
}

type Policy = { pageSize: number; scanPages: number; options: Stripe.RequestOptions };
async function policy(): Promise<Policy> {
  await refreshConfigCacheKeys([...CONFIG_KEYS, 'STRIPE_SECRET_KEY', 'STRIPE_TEST_SECRET_KEY', 'FOOD_TOUR_STRIPE_SECRET_KEY', 'FOOD_TOUR_STRIPE_TEST_SECRET_KEY']);
  return {
    pageSize: Math.max(10, Math.min(100, Number(getConfigValue(CONFIG_KEYS[1]) ?? 50))),
    scanPages: Math.max(1, Math.min(10, Number(getConfigValue(CONFIG_KEYS[2]) ?? 3))),
    options: { timeout: Math.max(1000, Math.min(30000, Number(getConfigValue(CONFIG_KEYS[0]) ?? 12000))), maxNetworkRetries: 0 },
  };
}

class UnlinkedPayment extends HttpError {
  constructor(public state: 'not_stripe' | 'not_linked' | 'unavailable', message: string) { super(state === 'unavailable' ? 502 : 409, message); }
}
type Context = {
  client: Stripe; mode: StripeMode; merchant: string; scope: 'order' | 'booking'; orderReference: string | null;
  intent: Stripe.PaymentIntent | null; charge: Stripe.Charge | null; reference: string;
};
type Read = <T>(path: string, run: () => Promise<T>) => Promise<T>;

function reader(requests: PaymentRequestReference[]): Read {
  return async (path, run) => {
    const created = Math.floor(Date.now() / 1000);
    try {
      const result = await run();
      const response = object(object(result).lastResponse);
      const requestId = text(response.requestId);
      if (requestId && /^req_[A-Za-z0-9]+$/.test(requestId)) requests.push({ id: requestId, created, source: 'refresh', description: 'Read during this refresh', method: 'GET', path, status: number(response.statusCode), dashboardUrl: '' });
      return result;
    } catch (error) {
      const requestId = text(object(error).requestId);
      if (requestId && /^req_[A-Za-z0-9]+$/.test(requestId)) requests.push({ id: requestId, created, source: 'refresh', description: 'Read during this refresh', method: 'GET', path, status: number(object(error).statusCode), dashboardUrl: '' });
      throw error;
    }
  };
}

/** Only a persisted booking reference selects a payment; query parameters never select Stripe objects or merchants. */
async function resolve(booking: Booking, settings: Policy, read: Read, requests: PaymentRequestReference[]): Promise<Context> {
  const platform = normalized(booking.platform);
  if (!['ecwid', 'omnilodge', 'direct'].includes(platform)) throw new UnlinkedPayment('not_stripe', 'This booking is paid through its booking platform. No OmniLodge Stripe payment is linked.');
  if (bankTransfer(booking.paymentMethod)) throw new UnlinkedPayment('not_stripe', 'This booking uses a bank transfer, so there is no Stripe card transaction to display.');
  let reference: string | null;
  let mode = extractDirectStripeMode(booking);
  let scope: Context['scope'] = 'booking';
  let orderReference: string | null = null;
  const merchant = normalizeDirectStripeMerchant(booking.stripeMerchant);
  if (platform === 'ecwid') {
    const orderId = String(booking.platformOrderId || booking.platformBookingId || '').trim().replace(/-\d+$/, '');
    if (!orderId) throw new UnlinkedPayment('not_linked', 'The Ecwid order reference has not been recorded.');
    let order;
    try { order = await getEcwidOrder(orderId); }
    catch { throw new UnlinkedPayment('unavailable', 'The linked Ecwid order could not be loaded. Check its order reference or Ecwid connection and retry.'); }
    reference = text(order.externalTransactionId);
    scope = 'order'; orderReference = orderId; mode = 'live';
  } else if (isStorefrontBooking(booking)) {
    const order = await StorefrontOrder.findOne({ where: { publicId: booking.platformOrderId } });
    if (!order) throw new UnlinkedPayment('not_linked', 'The linked storefront order could not be found.');
    if (bankTransfer(order.paymentMethod)) throw new UnlinkedPayment('not_stripe', 'This order uses a bank transfer. Its recorded payment information is shown below.');
    reference = text(order.stripePaymentIntentId); scope = 'order'; orderReference = order.publicId;
    const storedMode = object(order.metadata).stripeMode;
    if (storedMode === 'live' || storedMode === 'test') mode = storedMode;
  } else reference = extractDirectStripeTransactionId(booking);
  if (!reference || !/^(pi|ch)_[A-Za-z0-9]+$/.test(reference)) throw new UnlinkedPayment('not_linked', 'A Stripe PaymentIntent or charge reference has not been recorded for this payment.');

  let lastError: unknown;
  const modes: StripeMode[] = mode ? [mode] : process.env.NODE_ENV === 'production' ? ['live', 'test'] : ['test', 'live'];
  for (const candidate of modes) {
    const requestStart = requests.length;
    try {
      // Never fall back from the Food Tour merchant to a different merchant's credentials.
      const client = platform === 'ecwid' ? getStripeClient() : getDirectStripeClient(merchant, candidate);
      let intent: Stripe.PaymentIntent | null = null;
      let charge: Stripe.Charge | null = null;
      if (reference.startsWith('pi_')) {
        intent = await read(`/v1/payment_intents/${reference}`, () => client.paymentIntents.retrieve(reference!, { expand: ['latest_charge.balance_transaction', 'payment_method'] }, settings.options));
        if (intent.latest_charge && typeof intent.latest_charge === 'object') charge = intent.latest_charge;
        else if (typeof intent.latest_charge === 'string') charge = await read(`/v1/charges/${intent!.latest_charge}`, () => client.charges.retrieve(intent!.latest_charge as string, { expand: ['balance_transaction'] }, settings.options));
      } else {
        charge = await read(`/v1/charges/${reference}`, () => client.charges.retrieve(reference!, { expand: ['balance_transaction'] }, settings.options));
        const intentId = id(charge.payment_intent);
        if (intentId) intent = await read(`/v1/payment_intents/${intentId}`, () => client.paymentIntents.retrieve(intentId, { expand: ['payment_method'] }, settings.options));
      }
      const actualMode = (intent?.livemode ?? charge?.livemode) ? 'live' : 'test';
      if (actualMode !== candidate) throw new Error('Stripe mode mismatch.');
      return { client, mode: candidate, merchant: merchant === 'food-tour' ? 'Food Tour' : platform === 'ecwid' ? 'Ecwid' : 'OmniLodge', scope, orderReference, intent, charge, reference };
    } catch (error) {
      lastError = error;
      if (!mode && (missing(error) || (error instanceof HttpError && error.status === 503))) { requests.splice(requestStart); continue; }
      throw error;
    }
  }
  throw lastError;
}

function dashboard(context: Context, account: string | null, section: string, reference?: string): string {
  const accountPath = account && /^acct_[A-Za-z0-9]+$/.test(account) ? `${account}/` : '';
  return `https://dashboard.stripe.com/${accountPath}${context.mode === 'test' ? 'test/' : ''}${section}${reference ? '/' + encodeURIComponent(reference) : ''}`;
}

function methodDetails(charge: Stripe.Charge | null, intent: Stripe.PaymentIntent | null): PaymentMethodDetails | null {
  const details = object(charge?.payment_method_details);
  const paymentMethod = object(intent?.payment_method);
  const type = text(details.type ?? paymentMethod.type);
  if (!type) return null;
  const card = object(details.card ?? paymentMethod.card);
  const method = object(details[type] ?? paymentMethod[type]);
  const three = object(card.three_d_secure);
  return { type, brand: text(card.brand), last4: /^\d{4}$/.test(String(card.last4 ?? method.last4 ?? '')) ? String(card.last4 ?? method.last4) : null,
    expiryMonth: number(card.exp_month), expiryYear: number(card.exp_year), country: text(card.country ?? method.country), funding: text(card.funding), wallet: text(object(card.wallet).type),
    threeDSecure: Object.keys(three).length ? { result: text(three.result), version: text(three.version), flow: text(three.authentication_flow) } : null };
}

const receipt = (value: unknown): string | null => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')) ? url.href : null; } catch { return null; }
};

async function localActivity(booking: Booking, limit: number): Promise<{ rows: PaymentActivity[]; truncated: boolean }> {
  const events = await BookingEvent.findAll({ where: { bookingId: booking.id }, order: [['id', 'DESC']], limit: limit + 1 });
  const visible = events.slice(0, limit).filter(event => {
    const payload = object(event.eventPayload);
    return /payment|refund|cancel|stripe/i.test(String(payload.action ?? '') + ' ' + event.eventType) || Boolean(payload.stripeRefundId || payload.stripePaymentIntentId || payload.stripeTransactionId || payload.paymentStatus);
  });
  const actorIds = Array.from(new Set(visible.map(event => Number(object(event.eventPayload).actorId)).filter(value => Number.isSafeInteger(value) && value > 0)));
  const users = actorIds.length ? await User.findAll({ where: { id: { [Op.in]: actorIds } }, attributes: ['id', 'firstName', 'lastName'] }) : [];
  const names = new Map(users.map(user => [Number(user.id), [user.firstName, user.lastName].filter(Boolean).join(' ')]));
  return { truncated: events.length > limit, rows: visible.map(event => {
    const payload = object(event.eventPayload);
    const actorId = Number(payload.actorId);
    return { id: `booking-event-${event.id}`, source: 'omnilodge', title: human(text(payload.action) ?? event.eventType), created: time(event.occurredAt ?? event.processedAt ?? event.ingestedAt),
      status: event.statusAfter ?? null, amount: null, currency: null, actor: names.get(actorId) || (actorId > 0 ? `User #${actorId}` : null),
      reference: text(payload.stripeRefundId ?? payload.stripePaymentIntentId ?? payload.stripeTransactionId) };
  }) };
}

export async function getBookingPaymentDetails(bookingId: number): Promise<BookingPaymentDetails> {
  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const settings = await policy();
  const result: BookingPaymentDetails = {
    bookingId, state: 'unavailable', message: null, recorded: { amount: booking.priceGross == null ? null : String(booking.priceGross), currency: booking.currency ?? null,
      paymentStatus: booking.paymentStatus ?? null, paymentMethod: booking.paymentMethod ?? null, refundedAmount: booking.refundedAmount == null ? null : String(booking.refundedAmount), refundedCurrency: booking.refundedCurrency ?? null },
    scope: 'booking', orderReference: null, merchant: null, payment: null, charges: [], refunds: [], disputes: [], truncated: [], activity: [], requests: [], warnings: [], checkedAt: new Date().toISOString(),
  };
  try {
    const local = await localActivity(booking, settings.pageSize);
    result.activity = local.rows;
    if (local.truncated) result.truncated.push('activity');
  } catch { result.warnings.push('OmniLodge payment activity could not be loaded. The live Stripe payment is shown independently.'); }
  const read = reader(result.requests);
  let context: Context;
  try { context = await resolve(booking, settings, read, result.requests); }
  catch (error) {
    result.state = error instanceof UnlinkedPayment ? error.state : 'unavailable';
    result.message = error instanceof UnlinkedPayment ? error.message : paymentReadError(error);
    return result;
  }
  const { client, intent, charge } = context;
  const intentId = intent?.id ?? id(charge?.payment_intent);
  const filter = intentId ? { payment_intent: intentId } : { charge: charge!.id };
  let accountId: string | null = null;
  try { accountId = id(await read('/v1/account', () => client.accounts.retrieve({}, settings.options))); }
  catch { result.warnings.push('Stripe account identification is unavailable. Select the indicated merchant when opening Stripe.'); }
  const link = (section: string, reference?: string) => dashboard(context, accountId, section, reference);
  const load = async <T>(section: 'charges' | 'refunds' | 'disputes', fn: () => Promise<Stripe.ApiList<T>>): Promise<T[]> => {
    try { const page = await read(`/v1/${section}`, fn); if (page.has_more) result.truncated.push(section); return page.data; }
    catch (error) { result.warnings.push(`${human(section)}: ${paymentReadError(error)}`); return []; }
  };
  const [charges, refunds, disputes] = await Promise.all([
    intentId ? load('charges', () => client.charges.list({ payment_intent: intentId, limit: settings.pageSize }, settings.options)) : Promise.resolve(charge ? [charge] : []),
    load('refunds', () => client.refunds.list({ ...filter, limit: settings.pageSize }, settings.options)),
    load('disputes', () => client.disputes.list({ ...filter, limit: settings.pageSize }, settings.options)),
  ]);
  const canonical = intentId ?? charge!.id;
  const item = (row: { id: string; created: number; status?: string | null; amount: number; currency: string; reason?: string | null; description?: string | null }): PaymentItem =>
    ({ id: row.id, created: row.created, status: row.status ?? null, amount: row.amount, currency: row.currency, reason: text(row.reason), description: text(row.description), dashboardUrl: link('payments', canonical) });
  result.charges = charges.map(row => ({ ...item(row), status: row.paid && !row.captured ? 'requires_capture' : row.status, reason: text(row.failure_message ?? row.failure_code) }));
  result.refunds = refunds.map(item);
  result.disputes = disputes.map(item);
  const balance = charge?.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
  result.state = 'available'; result.merchant = context.merchant; result.scope = context.scope; result.orderReference = context.orderReference;
  result.payment = {
    id: canonical, paymentIntentId: intentId, chargeId: charge?.id ?? null, mode: context.mode, accountId,
    amount: intent?.amount ?? charge!.amount, amountReceived: intent?.amount_received ?? (charge?.captured ? charge.amount_captured : 0), amountCapturable: intent?.amount_capturable ?? (charge && !charge.captured ? charge.amount : 0),
    amountRefunded: charge?.amount_refunded ?? 0, currency: intent?.currency ?? charge!.currency,
    status: intent?.status ?? (charge?.paid && !charge.captured ? 'requires_capture' : charge!.status), created: intent?.created ?? charge!.created, canceledAt: intent?.canceled_at ?? null,
    receiptEmail: text(charge?.receipt_email ?? charge?.billing_details?.email ?? intent?.receipt_email), billingName: text(charge?.billing_details?.name),
    receiptUrl: receipt(charge?.receipt_url), description: text(intent?.description ?? charge?.description), statementDescriptor: text(charge?.calculated_statement_descriptor),
    paymentMethod: methodDetails(charge, intent), dashboardUrl: link('payments', canonical),
    settlement: balance ? { amount: balance.amount, fee: balance.fee, net: balance.net, currency: balance.currency } : null,
  };
  result.activity.push({ id: `payment-created-${canonical}`, source: 'stripe', title: 'Payment started', created: result.payment.created, status: null, amount: result.payment.amount, currency: result.payment.currency, actor: null, reference: canonical });
  if (intent?.canceled_at) result.activity.push({ id: `payment-cancelled-${canonical}`, source: 'stripe', title: 'Payment cancelled', created: intent.canceled_at, status: 'canceled', amount: null, currency: null, actor: null, reference: canonical });
  result.requests = result.requests.map(row => ({ ...row, dashboardUrl: link('logs', row.id) }));
  result.activity.sort((a, b) => b.created - a.created);
  return result;
}

function matchesPayment(event: Stripe.Event, context: Context): boolean {
  const row = object(event.data.object);
  const intentId = context.intent?.id ?? id(context.charge?.payment_intent);
  const chargeId = context.charge?.id;
  return Boolean((intentId && (row.id === intentId || id(row.payment_intent) === intentId)) || (chargeId && (row.id === chargeId || id(row.charge) === chargeId)));
}

/** The scan is bounded and resumable because Stripe Events has no object-ID filter. Unrelated event payloads never leave the server. */
export async function getBookingPaymentEvents(bookingId: number, cursor?: string): Promise<BookingPaymentEvents> {
  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const settings = await policy();
  const requests: PaymentRequestReference[] = [];
  const read = reader(requests);
  const context = await resolve(booking, settings, read, requests);
  let accountId: string | null = null;
  try { accountId = id(await read('/v1/account', () => context.client.accounts.retrieve({}, settings.options))); } catch { /* Payment lookup already established the merchant; account links are optional. */ }
  const now = Math.floor(Date.now() / 1000);
  let to = now, after: string | undefined;
  if (cursor) {
    const match = cursor.match(/^(\d{9,11})\.(evt_[A-Za-z0-9]+)$/);
    if (!match || Number(match[1]) > now || Number(match[1]) < now - STRIPE_RETENTION_SECONDS) throw new HttpError(400, 'The event cursor is invalid or expired. Refresh the payment to restart.');
    to = Number(match[1]); after = match[2];
  }
  const from = Math.max(now - STRIPE_RETENTION_SECONDS, context.intent?.created ?? context.charge?.created ?? 0);
  if (to < from) throw new HttpError(400, 'The event cursor belongs to an older payment window. Refresh the payment to restart.');
  const events: PaymentHistoryEvent[] = [];
  let hasMore = false, scanned = 0;
  for (let pageNumber = 0; pageNumber < settings.scanPages; pageNumber += 1) {
    const page = await read('/v1/events', () => context.client.events.list({ limit: settings.pageSize, created: { gte: from, lte: to }, ...(after ? { starting_after: after } : {}) }, settings.options));
    scanned += page.data.length;
    for (const event of page.data) {
      if (!matchesPayment(event, context)) continue;
      const row = object(event.data.object);
      const candidateRequestId = id(event.request);
      const requestId = candidateRequestId && /^req_[A-Za-z0-9]+$/.test(candidateRequestId) ? candidateRequestId : null;
      const eventUrl = dashboard(context, accountId, 'events', event.id);
      events.push({ id: event.id, type: event.type, created: event.created, objectId: id(row), status: text(row.status), amount: number(row.amount), currency: text(row.currency), requestId, dashboardUrl: eventUrl });
      if (requestId) requests.push({ id: requestId, created: event.created, source: 'event', description: human(event.type), method: null, path: null, status: null, dashboardUrl: dashboard(context, accountId, 'logs', requestId) });
    }
    hasMore = page.has_more;
    after = page.data.at(-1)?.id;
    if (!hasMore || !after) { hasMore = false; break; }
  }
  return { paymentId: context.intent?.id ?? context.charge!.id, mode: context.mode, events, requests: requests.map(row => ({ ...row, dashboardUrl: row.dashboardUrl || dashboard(context, accountId, 'logs', row.id) })), hasMore, nextCursor: hasMore && after ? `${to}.${after}` : null,
    scanned, from, to, checkedAt: new Date().toISOString() };
}
