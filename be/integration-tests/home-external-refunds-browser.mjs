// Local-only actual-page verification. Temporary credentials never leave memory.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import sequelize from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import UserType from '../src/models/UserType.ts';
import Product from '../src/models/Product.ts';
import Booking from '../src/models/Booking.ts';
import Channel from '../src/models/Channel.ts';
import Counter from '../src/models/Counter.ts';
import CounterChannelMetric from '../src/models/CounterChannelMetric.ts';
import AuditLog from '../src/models/AuditLog.ts';
assert.equal(process.env.NODE_ENV, 'development');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
const require = createRequire(new URL('../package.json', import.meta.url));
const puppeteer = require('puppeteer');
defineAssociations();
let browser, user, product, counter, booking;
const failures = [], checks = [];
try {
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  const role = await UserType.findOne({ where: { slug: 'admin' } });
  const channel = await Channel.findOne({ where: { name: 'Viator' } });
  const prefix = `home-refunds-${randomUUID()}`;
  const password = randomBytes(32).toString('hex');
  user = await User.create({ username: prefix, email: `${prefix}@example.invalid`, firstName: 'Homepage', lastName: 'QA',
    password: await bcrypt.hash(password, 10), userTypeId: role.id, roleKey: 'admin', badgeRequired: false,
    profilePhotoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', approved: true, status: true, createdBy: actor.id });
  product = await Product.create({ name: 'QA Pub Crawl', price: 100, status: true, productTypeId: (await Product.findOne()).productTypeId, createdBy: actor.id });
  counter = await Counter.create({ date: '2020-04-16', userId: user.id, createdBy: actor.id, productId: product.id, status: 'reservations' });
  booking = await Booking.create({ platform: 'viator', platformBookingId: prefix, channelId: channel.id, productId: product.id,
    productName: product.name, experienceDate: counter.date, status: 'confirmed', paymentStatus: 'paid',
    guestFirstName: 'Homepage Refund', guestLastName: 'QA', partySizeTotal: 3, attendedTotal: 3, attendanceStatus: 'checked_in_full',
    addonsSnapshot: { extras: { cocktails: 2, photos: 1, tshirts: 0 } }, attendedAddonsSnapshot: { cocktails: 1, photos: 0, tshirts: 0 },
    addonRefundActions: [{ id: 'browser-cocktail', addonKey: 'cocktails', quantity: 1, status: 'pending', counterId: counter.id },
      { id: 'browser-photo', addonKey: 'photos', quantity: 1, status: 'pending', counterId: counter.id }], createdBy: actor.id });
  const login = await fetch('http://localhost:3001/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.username, password }) });
  assert.equal(login.status, 200); const token = (await login.json())[0].token;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.on('pageerror', error => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) void request.continue();
    else void request.abort();
  });
  await page.evaluateOnNewDocument(value => localStorage.setItem('authToken', value), token);
  await page.setCookie({ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
  const selector = 'section[aria-label="Pending External Refunds"]';
  await page.waitForSelector(selector, { timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('Homepage Refund QA'));
  checks.push('Authenticated homepage lists existing pending booking and add-ons');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 1000 });
    assert.equal(await page.$eval(selector, element => element.scrollWidth <= element.clientWidth + 1), true, `Refund section overflows ${width}`);
    checks.push(`Refund section fits ${width}px`);
    if (width === 390) await (await page.$(selector)).screenshot({ path: join(process.env.USERPROFILE, '.omnilodge-local', 'partners-portal', 'home-refunds-mobile.png') });
  }
  await page.click('button[aria-label="Complete Cocktails refund for Homepage Refund QA"]');
  await page.waitForSelector('[role="dialog"]');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Confirm completed').click());
  await page.waitForFunction(() => document.body.innerText.includes('Booking add-ons and counter metrics updated.'));
  await booking.reload(); assert.equal(booking.addonsSnapshot.extras.cocktails, 1);
  assert.equal(booking.addonRefundActions[0].status, 'completed');
  checks.push('Complete persists booking add-ons and removes its pending item');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.click('button[aria-label="Delete Photos refund for Homepage Refund QA"]');
  await page.waitForSelector('[role="dialog"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some(button => button.textContent === 'Delete task'));
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Delete task').click());
  await page.waitForFunction(() => document.body.innerText.includes('Pending refund deleted.'));
  await booking.reload(); assert.equal(booking.addonsSnapshot.extras.photos, 1);
  assert.equal(booking.addonRefundActions.length, 1);
  checks.push('Delete removes only the pending task without recording a refund');
  await page.goto('http://localhost:3000/settings/home-experience', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Pending External Refunds'));
  checks.push('Existing Home Experience settings expose the new audience configuration');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ checks, browserErrors: failures }));
} finally {
  if (browser) await browser.close();
  if (booking) { await AuditLog.destroy({ where: { entity: 'booking', entityId: String(booking.id) } }); await booking.destroy(); }
  if (counter) { await CounterChannelMetric.destroy({ where: { counterId: counter.id } }); await counter.destroy(); }
  if (product) await product.destroy();
  if (user) { await sequelize.query('DELETE FROM auth_sessions WHERE actor_id = :id', { replacements: { id: user.id } }); await user.destroy(); }
  await sequelize.close();
}
