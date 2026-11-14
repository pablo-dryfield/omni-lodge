// Explicit LOCAL opt-in; all provider responses are simulated and outbound mail is disabled.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import sequelize from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import UserType from '../src/models/UserType.ts';
import Product from '../src/models/Product.ts';
import Channel from '../src/models/Channel.ts';
import PaymentMethod from '../src/models/PaymentMethod.ts';
import { PartnerProfile, PartnerBooking, PartnerPayment, PartnerEvent, PartnerAmendment } from '../src/models/Partner.ts';
import StorefrontOrder from '../src/models/StorefrontOrder.ts';
import StorefrontOrderItem from '../src/models/StorefrontOrderItem.ts';
import Booking from '../src/models/Booking.ts';
import BookingAddon from '../src/models/BookingAddon.ts';
import BookingEvent from '../src/models/BookingEvent.ts';
import Guest from '../src/models/Guest.ts';
import { initializeConfigRegistry } from '../src/services/configService.ts';
import { createPartnerBooking } from '../src/services/partners/partnerBookingService.ts';
import { amendPartnerBooking } from '../src/services/partners/partnerAmendmentService.ts';
import { changePartnerBooking } from '../src/services/partners/partnerActions.ts';
import { recordExternalPartnerRefund } from '../src/services/partners/partnerRefundService.ts';
import { reconcileRuleCommission } from '../src/services/partners/partnerRuleReconciliation.ts';
import { partnerStatement } from '../src/services/partners/partnerStripeService.ts';
import { defaultAgreement, opaqueToken } from '../src/services/partners/partnerPolicy.ts';
import { getStorefrontStripeClient } from '../src/finance/services/stripeClient.ts';

test('local commission lifecycle, saved rates, refund credits and real SQL rollback after provider success',
  { skip: process.env.PARTNER_COMMISSION_INTEGRATION_TEST !== 'true' }, async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
  assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
  defineAssociations(); await initializeConfigRegistry();
  const prefix = `commission-qa-${randomUUID()}`;
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  let user, channel, partner;
  const products = [];
  try {
    const role = await UserType.findOne({ where: { slug: 'admin' } });
    const password = randomBytes(32).toString('hex');
    user = await User.create({ username: prefix, email: `${prefix}@example.invalid`, firstName: 'Commission', lastName: 'QA',
      password: await bcrypt.hash(password, 10), userTypeId: role.id, roleKey: 'admin', status: true, approved: true,
      badgeRequired: false, profilePhotoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', createdBy: actor.id });
    const login = await fetch('http://localhost:3001/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.username, password }) });
    assert.equal(login.status, 200); const token = (await login.json())[0].token;
    const api = async (path, body) => fetch('http://localhost:3001/api/partners/' + partner.id + '/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'token=' + token, Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
    });
    const method = await PaymentMethod.findOne();
    channel = await Channel.create({ name: prefix, description: prefix, apiKey: '', apiSecret: '', paymentMethodId: method.id, createdBy: actor.id });
    for (let i = 0; i < 2; i++) products.push(await Product.create({ name: `${prefix}-${i}`, description: prefix, price: 100, status: true,
      productTypeId: (await Product.findOne()).productTypeId, createdBy: actor.id,
      storefrontConfig: { dateRequired: true, timeMode: 'select', startTimes: ['17:00', '19:30'], minParticipants: 1, maxParticipants: 50 } }));
    const agreement = { ...defaultAgreement, productIds: products.map(product => product.id),
      commissionRule: { type: 'fixed', basis: 'person', value: 10 },
      productCommissions: [{ productId: products[1].id, rule: { type: 'fixed', basis: 'experience', value: 30 } }],
      paymentModes: ['partner', 'arrival', 'platform'], creditLimit: 10000, allowAmendment: true, allowCancellation: true, allowRefunds: true };
    partner = await PartnerProfile.create({ channelId: channel.id, publicCode: opaqueToken(), name: prefix, agreement, createdBy: actor.id });
    const context = { partner, actorId: actor.id, role: 'admin', admin: true, scopes: null };
    const line = (product, quantity, date = '2032-01-01') => ({ productId: product.id, quantity, experienceDate: date, experienceTime: '17:00' });
    const customer = { firstName: 'Commission', lastName: prefix, email: `${prefix}@example.invalid` };
    const initial = await createPartnerBooking(context, { reference: prefix, customer, paymentMode: 'partner', paymentReference: 'offline-collection',
      items: [line(products[0], 2), line(products[1], 3, '2032-01-02')] }, 'portal');
    let row = await PartnerBooking.findByPk(initial.id);
    assert.equal(Number(row.commission), 50);
    await partner.update({ agreement: { ...agreement, commissionRule: { type: 'fixed', basis: 'person', value: 100 },
      productCommissions: [{ productId: products[1].id, rule: { type: 'fixed', basis: 'experience', value: 300 } }] } });
    await amendPartnerBooking(context, row.id, { reference: 'remove-one-guest', reason: 'QA verified guest removal', paymentReference: 'offline-refund-100',
      items: [line(products[0], 1), line(products[1], 3, '2032-01-02')], notifyCustomer: false });
    await row.reload(); assert.equal(Number(row.commission), 40, 'Saved agreement must survive a changed current partner rate');
    await amendPartnerBooking(context, row.id, { reference: 'same-price-product-change', reason: 'QA same-price product substitution',
      items: [line(products[1], 4, '2032-01-02')], notifyCustomer: false });
    await row.reload(); assert.equal(Number(row.commission), 30);
    assert.equal(Number((await StorefrontOrder.findByPk(row.orderId)).total), 400);
    await recordExternalPartnerRefund(context, row.id, { amount: 390, reference: 'external-refund-390', reason: 'QA verified external refund' });
    await row.reload();
    assert.equal(partnerStatement(row).commission, 30); assert.equal(partnerStatement(row).partnerCredit, 20);
    const credit = { amount: 20, reference: 'credit-receipt-20', reason: 'QA completed external credit payment' };
    assert.equal((await api(`bookings/${row.id}/settlement-return`, credit)).status, 200);
    assert.equal((await api(`bookings/${row.id}/settlement-return`, credit)).status, 200);
    await row.reload(); assert.equal(Number(row.partnerCreditPaid), 20); assert.equal(partnerStatement(row).partnerCredit, 0);
    assert.equal((await api(`bookings/${row.id}/settlement-return`, { ...credit, reference: 'overpay', amount: 1 })).status, 409);
    await recordExternalPartnerRefund(context, row.id, { amount: 10, reference: 'final-refund-10', reason: 'QA full monetary refund' });
    await row.reload(); assert.equal(row.status, 'refunded'); assert.equal(partnerStatement(row).commission, 30);
    await changePartnerBooking(context, row.id, 'cancel', { reason: 'QA experience cancellation', notifyCustomer: false });
    await row.reload(); assert.equal(row.status, 'cancelled'); assert.equal(partnerStatement(row).commission, 0);
    assert.equal(partnerStatement(row).partnerOwes, 20, 'Previously paid credit must be recoverable after cancellation');
    assert.equal((await api(`bookings/${row.id}/settlement`, { amount: 20, reference: 'returned-credit-20', reason: 'QA verified recovery receipt' })).status, 200);
    await row.reload(); assert.equal(partnerStatement(row).partnerOwes, 0);

    // A transfer can succeed while the surrounding SQL transaction rolls back.
    // Re-created PartnerPayment IDs must not cause another transfer.
    await partner.update({ agreement: { ...agreement, productCommissions: [], connectSplit: true }, connectAccounts: { test: 'acct_offline' } });
    const platform = await createPartnerBooking(context, { reference: prefix + '-stripe', customer, paymentMode: 'arrival', items: [line(products[0], 2)] }, 'portal');
    const order = await StorefrontOrder.findByPk((await PartnerBooking.findByPk(platform.id)).orderId);
    await order.update({ paymentStatus: 'paid', paymentMethod: 'stripe', stripePaymentIntentId: 'pi_commission_offline' });
    await PartnerBooking.update({ paymentMode: 'platform', paymentReceived: true }, { where: { id: platform.id } });
    const transfers = [];
    let created = 0, reversals = 0;
    const charge = { id: 'ch_commission_offline', amount: 20000, amount_refunded: 0, paid: true, currency: 'pln', disputed: false, payment_method_details: { type: 'card' } };
    const fake = { accounts: { retrieve: async () => ({ capabilities: { transfers: 'active' }, payouts_enabled: true }) }, transfers: {
      list: async ({ transfer_group }) => ({ data: structuredClone(transfers.filter(value => value.transfer_group === transfer_group)), has_more: false }),
      create: async input => { const value = { ...input, id: `tr_commission_${++created}`, source_transaction: input.source_transaction || null, amount_reversed: 0 }; transfers.push(structuredClone(value)); return structuredClone(value); },
      createReversal: async (id, { amount }) => { transfers.find(value => value.id === id).amount_reversed += amount; reversals++; return { amount, transfer: id }; },
    } };
    let rolledBackPaymentId;
    const apply = async fail => sequelize.transaction(async transaction => {
      const lockedOrder = await StorefrontOrder.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      const lockedBooking = await PartnerBooking.findByPk(platform.id, { transaction, lock: transaction.LOCK.UPDATE });
      const [payment] = await PartnerPayment.findOrCreate({ where: { bookingId: platform.id, reference: 'initial' },
        defaults: { paymentIntentId: 'pi_commission_offline', amount: 200, commission: 20 }, transaction });
      if (fail) rolledBackPaymentId = payment.id;
      await reconcileRuleCommission(fake, lockedBooking, lockedOrder, [{ payment, charge }], false, transaction, { mode: 'test', connectEnabled: true });
      if (fail) throw new Error('SQL rollback after successful provider commission');
    });
    await assert.rejects(apply(true), /SQL rollback/);
    assert.equal(created, 1); assert.equal(await PartnerPayment.count({ where: { bookingId: platform.id } }), 0);
    await apply(false); assert.equal(created, 1);
    const receipt = await PartnerPayment.findOne({ where: { bookingId: platform.id } });
    assert.notEqual(receipt.id, rolledBackPaymentId);
    assert.equal(Number((await PartnerBooking.findByPk(platform.id)).commissionTransferred), 20);
    charge.amount_refunded = 19000; await apply(false);
    assert.equal(reversals, 0, 'Money-only refund must keep the fixed commission');

    const stripe = getStorefrontStripeClient();
    const old = [stripe.paymentIntents.retrieve, stripe.transfers.list, stripe.transfers.create, stripe.transfers.createReversal, stripe.accounts.retrieve, stripe._requestSender._request];
    try {
      stripe._requestSender._request = () => { throw new Error('Unexpected real provider request'); };
      stripe.paymentIntents.retrieve = async () => ({ status: 'succeeded', amount_received: 20000, currency: 'pln', metadata: { orderPublicId: order.publicId }, latest_charge: charge });
      stripe.transfers.list = fake.transfers.list; stripe.transfers.create = fake.transfers.create;
      stripe.transfers.createReversal = fake.transfers.createReversal; stripe.accounts.retrieve = fake.accounts.retrieve;
      await products[0].update({ price: 200 });
      await amendPartnerBooking(context, platform.id, { reference: 'same-price-guest-removal', reason: 'QA one guest at current price', items: [line(products[0], 1)], notifyCustomer: false });
      const changed = await PartnerBooking.findByPk(platform.id);
      assert.equal(Number(changed.commission), 10); assert.equal(Number(changed.commissionTransferred), 10); assert.equal(reversals, 1);
    } finally {
      [stripe.paymentIntents.retrieve, stripe.transfers.list, stripe.transfers.create, stripe.transfers.createReversal, stripe.accounts.retrieve, stripe._requestSender._request] = old;
    }
    console.log('PASS: frozen product rules, same-price amendments, fixed refund fees, credit receipt replay/limits, cancellation recovery, provider/SQL rollback without duplicate transfer');
  } finally {
    if (partner) {
      const rows = await PartnerBooking.findAll({ where: { partnerId: partner.id } });
      const guests = new Set();
      for (const row of rows) if (row.orderId) {
        const order = await StorefrontOrder.findByPk(row.orderId);
        const bookings = await Booking.findAll({ where: { platformOrderId: order.publicId } });
        for (const booking of bookings) {
          if (booking.guestId) guests.add(booking.guestId);
          await BookingEvent.destroy({ where: { bookingId: booking.id } }); await BookingAddon.destroy({ where: { bookingId: booking.id } }); await booking.destroy();
        }
        await PartnerPayment.destroy({ where: { bookingId: row.id } }); await PartnerAmendment.destroy({ where: { bookingId: row.id } });
      }
      await PartnerEvent.destroy({ where: { partnerId: partner.id } }); await PartnerBooking.destroy({ where: { partnerId: partner.id } });
      for (const row of rows) if (row.orderId) { await StorefrontOrderItem.destroy({ where: { orderId: row.orderId } }); await StorefrontOrder.destroy({ where: { id: row.orderId } }); }
      for (const id of guests) await Guest.destroy({ where: { id } });
      await partner.destroy();
    }
    for (const product of products) await product.destroy(); if (channel) await channel.destroy();
    if (user) { await sequelize.query('DELETE FROM auth_sessions WHERE actor_id = :id', { replacements: { id: user.id } }); await user.destroy(); }
    await sequelize.close();
  }
});
