// Explicit opt-in: this creates isolated fixtures in a LOCAL database and removes them in finally.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sequelize from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import Channel from '../src/models/Channel.ts';
import Product from '../src/models/Product.ts';
import PaymentMethod from '../src/models/PaymentMethod.ts';
import { PartnerBooking, PartnerProfile, PartnerEvent, PartnerMember, PartnerPayment, PartnerAmendment } from '../src/models/Partner.ts';
import StorefrontOrder from '../src/models/StorefrontOrder.ts';
import StorefrontOrderItem from '../src/models/StorefrontOrderItem.ts';
import Booking from '../src/models/Booking.ts';
import BookingEvent from '../src/models/BookingEvent.ts';
import BookingAddon from '../src/models/BookingAddon.ts';
import Guest from '../src/models/Guest.ts';
import { createPartnerBooking, approvePartnerRequest } from '../src/services/partners/partnerBookingService.ts';
import { amendPartnerBooking, completePartnerAmendment } from '../src/services/partners/partnerAmendmentService.ts';
import { refundPartnerBooking } from '../src/services/partners/partnerRefundService.ts';
import { getStorefrontStripeClient } from '../src/finance/services/stripeClient.ts';
import { resolvePartner } from '../src/services/partners/partnerAccess.ts';
import { defaultAgreement, opaqueToken } from '../src/services/partners/partnerPolicy.ts';
import { initializeConfigRegistry } from '../src/services/configService.ts';

test('local PostgreSQL partner booking, retries, credit and tenant boundaries', { skip: process.env.PARTNERS_INTEGRATION_TEST !== 'true' }, async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
  assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
  defineAssociations();
  await sequelize.authenticate();
  await initializeConfigRegistry();
  const prefix = `partner-qa-${randomUUID()}`;
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  const payment = await PaymentMethod.findOne({ order: [['id', 'ASC']] });
  assert.ok(actor && payment);
  let channel, product, partner, second;
  try {
    channel = await Channel.create({ name: prefix, description: 'Local QA only', apiKey: '', apiSecret: '', createdBy: actor.id, paymentMethodId: payment.id });
    product = await Product.create({ name: prefix, price: 100, productTypeId: (await Product.findOne({ order: [['id', 'ASC']] })).productTypeId, createdBy: actor.id, status: true, storefrontConfig: { dateRequired: true, timeMode: 'select', startTimes: ['17:00', '19:30'], minParticipants: 1, maxParticipants: 50 } });
    partner = await PartnerProfile.create({ channelId: channel.id, publicCode: opaqueToken(), name: prefix, agreement: { ...defaultAgreement, productIds: [product.id], commissionPercent: 20, paymentModes: ['platform', 'partner', 'arrival'], creditLimit: 200 }, createdBy: actor.id });
    const context = { partner, actorId: actor.id, role: 'administrator', admin: true, scopes: null };
    const selection = { reference: 'qa-arrival', customer: { firstName: 'QA', lastName: 'Customer', email: 'partner-qa@example.invalid' }, paymentMode: 'arrival', items: [{ productId: product.id, quantity: 2, experienceDate: '2027-03-10', experienceTime: '17:00' }] };
    const [first, retry] = await Promise.all([createPartnerBooking(context, selection, 'portal'), createPartnerBooking(context, selection, 'api')]);
    assert.equal(first.id, retry.id);
    assert.equal(await PartnerBooking.count({ where: { partnerId: partner.id, externalReference: selection.reference } }), 1);
    assert.equal(first.total, 200);
    assert.equal(first.commission, 40);
    const row = await PartnerBooking.findByPk(first.id);
    const order = await StorefrontOrder.findByPk(row.orderId);
    const operational = await Booking.findOne({ where: { platformOrderId: order.publicId } });
    assert.equal(Number(operational.channelId), Number(channel.id));
    assert.equal(operational.paymentStatus, 'unpaid');
    assert.equal(operational.status, 'confirmed');
    await assert.rejects(createPartnerBooking(context, { ...selection, items: [{ ...selection.items[0], experienceTime: '19:30' }] }, 'api'), /already used/);
    const later = await createPartnerBooking(context, { ...selection, reference: 'qa-other-departure', items: [{ ...selection.items[0], experienceTime: '19:30' }] }, 'portal');
    assert.notEqual(later.id, first.id);
    const paid = await createPartnerBooking(context, { ...selection, reference: 'qa-partner-paid', paymentMode: 'partner', paymentReference: 'test-receipt' }, 'portal');
    assert.equal(paid.total, 200);
    await assert.rejects(createPartnerBooking(context, { ...selection, reference: 'qa-credit-exceeded', paymentMode: 'partner', paymentReference: 'other-receipt' }, 'portal'), /credit limit/);
    await assert.rejects(createPartnerBooking(context, { ...selection, reference: 'qa-public-forgery' }, 'website', true), /Public checkout/);
    await assert.rejects(createPartnerBooking(context, { ...selection, reference: 'approved:1234' }, 'api'), /reserved/);
    const requested = await createPartnerBooking(context, { ...selection, reference: 'qa-request', requestApproval: true }, 'portal');
    assert.equal((await PartnerBooking.findByPk(requested.id)).orderId, null);
    const approved = await approvePartnerRequest(context, requested.id, true, 'QA group approval');
    assert.ok(approved.id);
    const approvedRetry = await approvePartnerRequest(context, requested.id, true, 'QA retry');
    assert.equal(approvedRetry.id, approved.id);
    await PartnerMember.create({ partnerId: partner.id, userId: actor.id, role: 'agent', active: true });
    const request = { params: { partnerId: String(partner.id) }, headers: {}, authContext: { id: actor.id, roleSlug: 'partner' }, productTypeScope: null };
    assert.equal((await resolvePartner(request, 'book')).role, 'agent');
    await assert.rejects(resolvePartner(request, 'integrations'), /role/);
    await PartnerMember.update({ active: false }, { where: { partnerId: partner.id, userId: actor.id } });
    await assert.rejects(resolvePartner(request, 'read'), /access/);
    // Provider methods are replaced in memory. Any unexpected Stripe request is blocked.
    const stripe = getStorefrontStripeClient();
    const methods = [stripe.paymentIntents.retrieve, stripe.checkout.sessions.create, stripe.checkout.sessions.retrieve, stripe.checkout.sessions.expire, stripe.refunds.list, stripe.refunds.create];
    const originalRequest = stripe._requestSender._request;
    stripe._requestSender._request = () => { throw new Error('Unexpected provider network request during local integration test'); };
    const intents = new Map(), sessions = new Map(), refunds = new Map();
    let sequence = 0;
    const intent = (id, amount, metadata) => ({ id, status: 'succeeded', currency: 'pln', amount_received: amount, metadata, latest_charge: { id: 'ch_' + id, paid: true, amount, amount_refunded: 0, disputed: false } });
    try {
      stripe.paymentIntents.retrieve = async id => { assert.ok(intents.has(id), 'Unknown offline payment'); return intents.get(id); };
      stripe.checkout.sessions.create = async params => {
        const id = 'cs_offline_' + (++sequence);
        const value = { id, url: 'https://checkout.stripe.com/c/pay/' + id, status: 'open', payment_status: 'unpaid', payment_intent: null, metadata: params.metadata, params };
        sessions.set(id, value); return value;
      };
      stripe.checkout.sessions.retrieve = async id => { assert.ok(sessions.has(id)); return sessions.get(id); };
      stripe.checkout.sessions.expire = async id => { const value = sessions.get(id); assert.equal(value.status, 'open'); value.status = 'expired'; return value; };
      stripe.refunds.list = async params => ({ data: [...refunds.values()].filter(value => value.payment_intent === params.payment_intent), has_more: false });
      stripe.refunds.create = async (params, options) => {
        if (refunds.has(options.idempotencyKey)) return refunds.get(options.idempotencyKey);
        const charge = intents.get(params.payment_intent).latest_charge;
        assert.ok(params.amount <= charge.amount - charge.amount_refunded);
        charge.amount_refunded += params.amount;
        const value = { id: 're_offline_' + (++sequence), status: 'succeeded', ...params };
        refunds.set(options.idempotencyKey, value); return value;
      };
      const financial = await PartnerBooking.findByPk(first.id);
      await financial.update({ paymentMode: 'platform', paymentReceived: true, snapshot: { ...financial.snapshot, connectSplit: false } });
      await order.update({ paymentStatus: 'paid', paymentMethod: 'stripe', stripePaymentIntentId: 'pi_offline_initial' });
      await operational.update({ paymentStatus: 'paid' });
      intents.set('pi_offline_initial', intent('pi_offline_initial', 20000, { orderPublicId: order.publicId }));
      const change = { reference: 'amend-quantity-up', reason: 'Customer added a guest', notifyCustomer: false, items: [{ ...selection.items[0], quantity: 3 }] };
      const pending = await amendPartnerBooking(context, first.id, change);
      assert.equal(pending.status, 'pending_payment');
      assert.equal(pending.difference, 100);
      assert.equal((await Booking.findByPk(operational.id)).partySizeTotal, 2, 'Unpaid change must preserve the original booking');
      assert.equal((await amendPartnerBooking(context, first.id, change)).id, pending.id, 'Retry must return the same amendment');
      const makePaid = async amendmentId => {
        const amendment = await PartnerAmendment.findByPk(amendmentId);
        const session = sessions.get(amendment.checkoutSessionId);
        const pi = intent('pi_offline_' + amendmentId, Math.round(Number(amendment.difference) * 100), session.params.payment_intent_data.metadata);
        intents.set(pi.id, pi); session.payment_intent = pi; session.status = 'complete'; session.payment_status = 'paid';
      };
      await makePaid(pending.id);
      await Promise.all([completePartnerAmendment(pending.id), completePartnerAmendment(pending.id)]);
      assert.equal((await Booking.findByPk(operational.id)).partySizeTotal, 3);
      assert.equal(Number((await PartnerBooking.findByPk(first.id)).total), 300);
      assert.equal(await PartnerPayment.count({ where: { bookingId: first.id } }), 2);
      await refundPartnerBooking(context, first.id, { amount: 50, reference: 'goodwill', reason: 'Customer service', notifyCustomer: false });
      assert.equal(Number((await Booking.findByPk(operational.id)).baseAmount), 250);
      const down = await amendPartnerBooking(context, first.id, { reference: 'amend-quantity-down', reason: 'One guest cancelled', notifyCustomer: false, items: selection.items });
      assert.equal(down.status, 'completed');
      const reduced = await PartnerBooking.findByPk(first.id);
      assert.equal(Number(reduced.refundedAmount), 150);
      assert.equal(Number(reduced.amendmentRefundedAmount), 100);
      assert.equal(Number((await Booking.findByPk(operational.id)).baseAmount), 150, 'Price adjustment must not deduct the same refund twice');
      const unavailable = await amendPartnerBooking(context, first.id, { ...change, reference: 'amend-unavailable-after-payment' });
      await makePaid(unavailable.id);
      await product.update({ status: false });
      await assert.rejects(completePartnerAmendment(unavailable.id));
      await product.update({ status: true });
      assert.equal((await PartnerAmendment.findByPk(unavailable.id)).status, 'failed');
      assert.equal((await Booking.findByPk(operational.id)).partySizeTotal, 2);
      const retained = await PartnerBooking.findByPk(first.id);
      assert.equal(Number(retained.total) - Number(retained.refundedAmount), 150, 'Unavailable upgrade must return only the extra payment');
      assert.equal(Number((await Booking.findByPk(operational.id)).baseAmount), 150);
      const rollbackBooking = await createPartnerBooking(context, { ...selection, reference: 'qa-refund-rollback' }, 'portal');
      const rollbackRow = await PartnerBooking.findByPk(rollbackBooking.id);
      const rollbackOrder = await StorefrontOrder.findByPk(rollbackRow.orderId);
      await rollbackRow.update({ paymentMode: 'platform', paymentReceived: true });
      await rollbackOrder.update({ paymentStatus: 'paid', paymentMethod: 'stripe', stripePaymentIntentId: 'pi_offline_rollback' });
      intents.set('pi_offline_rollback', intent('pi_offline_rollback', 20000, { orderPublicId: rollbackOrder.publicId }));
      const originalEventCreate = PartnerEvent.create;
      PartnerEvent.create = async function(values, options) {
        if (values.bookingId === rollbackRow.id && values.type === 'refund.submitted') throw new Error('Injected database transaction rollback after provider success');
        return originalEventCreate.call(this, values, options);
      };
      const refundRequest = { amount: 10, reference: 'same-ref-after-rollback', reason: 'Offline rollback regression', notifyCustomer: false };
      try { await assert.rejects(refundPartnerBooking(context, rollbackRow.id, refundRequest), /Injected database/); }
      finally { PartnerEvent.create = originalEventCreate; }
      assert.equal(await PartnerPayment.count({ where: { bookingId: rollbackRow.id } }), 0, 'Initial payment ledger insert must actually roll back');
      const refundsBeforeRetry = refunds.size;
      await refundPartnerBooking(context, rollbackRow.id, refundRequest);
      assert.equal(refunds.size, refundsBeforeRetry, 'Retry with a regenerated ledger row must not issue another refund');
      assert.equal(Number((await PartnerBooking.findByPk(rollbackRow.id)).refundedAmount), 10);
    } finally {
      [stripe.paymentIntents.retrieve, stripe.checkout.sessions.create, stripe.checkout.sessions.retrieve, stripe.checkout.sessions.expire, stripe.refunds.list, stripe.refunds.create] = methods;
      stripe._requestSender._request = originalRequest;
    }
    console.log(JSON.stringify({ duplicateBookings: 0, distinctDepartures: true, creditLimitEnforced: true, channelProjection: true, localMailDisabled: true, automaticPriceAdjustments: true, multiChargeRefunds: true, unavailableUpgradeRefunded: true, actualDatabaseRollbackRefundDeduplicated: true }));
  } finally {
    if (partner) {
      const rows = await PartnerBooking.findAll({ where: { partnerId: partner.id } });
      for (const row of rows) {
        if (!row.orderId) continue;
        const order = await StorefrontOrder.findByPk(row.orderId);
        const bookings = await Booking.findAll({ where: { platformOrderId: order.publicId } });
        for (const booking of bookings) {
          await BookingEvent.destroy({ where: { bookingId: booking.id } });
          await BookingAddon.destroy({ where: { bookingId: booking.id } });
          const guestId = booking.guestId;
          await booking.destroy();
          if (guestId) await Guest.destroy({ where: { id: guestId } });
        }
        await PartnerEvent.destroy({ where: { bookingId: row.id } });
      }
      await PartnerEvent.destroy({ where: { partnerId: partner.id } });
      await PartnerMember.destroy({ where: { partnerId: partner.id } });
      for (const value of rows) { await PartnerPayment.destroy({ where: { bookingId: value.id } }); await PartnerAmendment.destroy({ where: { bookingId: value.id } }); }
      await PartnerBooking.destroy({ where: { partnerId: partner.id } });
      for (const row of rows) if (row.orderId) {
        await StorefrontOrderItem.destroy({ where: { orderId: row.orderId } });
        await StorefrontOrder.destroy({ where: { id: row.orderId } });
      }
      await partner.destroy();
    }
    if (second) await second.destroy();
    if (product) await product.destroy();
    if (channel) await channel.destroy();
    await sequelize.close();
  }
});
