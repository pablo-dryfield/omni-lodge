// Explicit local opt-in. No emails, money movement or production access.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sequelize from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import Product from '../src/models/Product.ts';
import ProductType from '../src/models/ProductType.ts';
import Booking from '../src/models/Booking.ts';
import Channel from '../src/models/Channel.ts';
import Counter from '../src/models/Counter.ts';
import CounterChannelMetric from '../src/models/CounterChannelMetric.ts';
import Addon from '../src/models/Addon.ts';
import AuditLog from '../src/models/AuditLog.ts';
import Registry from '../src/services/counterRegistryService.ts';
import { initializeConfigRegistry } from '../src/services/configService.ts';
import { listPendingExternalRefunds } from '../src/services/pendingExternalRefundService.ts';
import { changeBookingAddonRefundAction } from '../src/services/bookingAddonRefundActionService.ts';

test('external refunds: real counter metrics, rollback and concurrent completion',
  { skip: process.env.EXTERNAL_REFUNDS_INTEGRATION_TEST !== 'true' }, async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
  assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
  defineAssociations(); await initializeConfigRegistry();
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  const channel = await Channel.findOne({ where: { name: 'Viator' } });
  const cocktail = (await Addon.findAll({ where: { isActive: true } })).find(row => /cocktail/i.test(row.name));
  assert.ok(actor && channel && cocktail);
  const prefix = `refund-qa-${randomUUID()}`;
  let type, product, counter, booking, second;
  const upsert = Registry.upsertMetrics;
  try {
    type = await ProductType.create({ name: prefix, createdBy: actor.id });
    product = await Product.create({ name: prefix, price: 100, status: true, productTypeId: type.id, createdBy: actor.id });
    counter = await Counter.create({ date: '2039-04-16', userId: actor.id, createdBy: actor.id, productId: product.id, status: 'reservations' });
    const action = { id: 'cocktail-refund', addonKey: 'cocktails', quantity: 1, status: 'pending', counterId: counter.id };
    booking = await Booking.create({ platform: 'viator', platformBookingId: prefix, productId: product.id, productName: prefix,
      channelId: channel.id, experienceDate: counter.date, status: 'confirmed', paymentStatus: 'paid',
      guestFirstName: 'Refund', guestLastName: 'QA', partySizeTotal: 3, attendedTotal: 3, attendanceStatus: 'checked_in_full',
      addonsSnapshot: { extras: { cocktails: 2, photos: 1, tshirts: 0 } }, attendedAddonsSnapshot: { cocktails: 1, photos: 0, tshirts: 0 },
      addonRefundActions: [action, { id: 'ignored', addonKey: 'tshirts', status: 'declined', quantity: 1 },
        { id: 'invalid', addonKey: 'photos', quantity: 'not-numeric' }], sourceReceivedAt: new Date('2039-04-16T12:00:00Z'), createdBy: actor.id });
    const page = await listPendingExternalRefunds([type.id], 1, 0);
    assert.equal(page.meta.totalBookings, 1); assert.equal(page.data[0].actions.length, 1);
    assert.equal(page.data[0].actions[0].counterId, counter.id);
    assert.equal((await listPendingExternalRefunds([], 8, 0)).meta.totalBookings, 0);
    await Registry.upsertMetrics(counter.id, [], actor.id);
    Registry.upsertMetrics = async () => { throw new Error('Simulated metric persistence failure'); };
    await assert.rejects(changeBookingAddonRefundAction(booking.id, action.id, 'complete', actor.id), /Simulated/);
    await booking.reload();
    assert.equal(booking.addonsSnapshot.extras.cocktails, 2);
    assert.equal(booking.addonRefundActions[0].status, 'pending');
    Registry.upsertMetrics = upsert;
    second = await Booking.create({ platform: 'viator', platformBookingId: prefix + '-2', productId: product.id,
      channelId: channel.id, experienceDate: counter.date, status: 'confirmed', paymentStatus: 'paid',
      partySizeTotal: 2, attendedTotal: 2, attendanceStatus: 'checked_in_full',
      addonsSnapshot: { extras: { cocktails: 1, photos: 0, tshirts: 0 } }, attendedAddonsSnapshot: { cocktails: 0 },
      addonRefundActions: [{ ...action, id: 'second-refund' }], createdBy: actor.id });
    await Promise.all([changeBookingAddonRefundAction(booking.id, action.id, 'complete', actor.id),
      changeBookingAddonRefundAction(booking.id, action.id, 'complete', actor.id),
      changeBookingAddonRefundAction(second.id, 'second-refund', 'complete', actor.id)]);
    await booking.reload();
    assert.equal(booking.addonsSnapshot.extras.cocktails, 1); assert.equal(booking.partySizeTotal, 3);
    assert.equal(booking.addonRefundActions[0].status, 'completed');
    assert.equal((await listPendingExternalRefunds([type.id], 8, 0)).meta.totalBookings, 0);
    const metrics = await CounterChannelMetric.findAll({ where: { counterId: counter.id, channelId: channel.id } });
    const count = (kind, addonId, tally) => metrics.filter(row => row.kind === kind && row.addonId === addonId && row.tallyType === tally)
      .reduce((sum, row) => sum + Number(row.qty), 0);
    assert.equal(count('addon', cocktail.id, 'booked'), 1);
    assert.equal(count('addon', cocktail.id, 'attended'), 1);
    assert.equal(count('people', null, 'attended'), 4);
    await second.reload(); assert.equal(second.addonsSnapshot.extras.cocktails, 0);
    assert.equal(await AuditLog.count({ where: { entity: 'booking', entityId: String(booking.id), action: 'booking.addon_refund.complete' } }), 1);
    booking.addonRefundActions = [{ ...action, id: 'delete-me', status: 'pending' }]; await booking.save();
    await changeBookingAddonRefundAction(booking.id, 'delete-me', 'delete', actor.id);
    await booking.reload(); assert.equal(booking.addonRefundActions.length, 0); assert.equal(booking.addonsSnapshot.extras.cocktails, 1);
    console.log('PASS: scoped queue, transaction rollback, concurrent idempotence, correct normal/add-on venue metrics, audit and deletion');
  } finally {
    Registry.upsertMetrics = upsert;
    if (second) { await AuditLog.destroy({ where: { entity: 'booking', entityId: String(second.id) } }); await second.destroy(); }
    if (booking) { await AuditLog.destroy({ where: { entity: 'booking', entityId: String(booking.id) } }); await booking.destroy(); }
    if (counter) { await CounterChannelMetric.destroy({ where: { counterId: counter.id } }); await counter.destroy(); }
    if (product) await product.destroy(); if (type) await type.destroy();
    await sequelize.close();
  }
});
