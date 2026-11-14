// Local-only actual-page smoke test. Credentials live in memory and fixtures are removed.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import sequelize from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import UserType from '../src/models/UserType.ts';
import Channel from '../src/models/Channel.ts';
import Product from '../src/models/Product.ts';
import PaymentMethod from '../src/models/PaymentMethod.ts';
import { PartnerProfile, PartnerMember } from '../src/models/Partner.ts';
import { defaultAgreement, opaqueToken } from '../src/services/partners/partnerPolicy.ts';

assert.equal(process.env.NODE_ENV, 'development');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
const require = createRequire(new URL('../package.json', import.meta.url));
const puppeteer = require('puppeteer');
defineAssociations();
const output = join(process.env.USERPROFILE, '.omnilodge-local', 'partners-portal');
await mkdir(output, { recursive: true });
let browser, page, user, channel, product, partner;
const failures = [];
const checks = [];
try {
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  const role = await UserType.findOne({ where: { slug: 'partner' } });
  const method = await PaymentMethod.findOne();
  const prefix = `partner-browser-${randomUUID()}`;
  const password = randomBytes(32).toString('hex');
  user = await User.create({ username: prefix, email: `${prefix}@example.invalid`, firstName: 'Portal', lastName: 'QA', password: await bcrypt.hash(password, 10), userTypeId: role.id, roleKey: 'guide', badgeRequired: false, profilePhotoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', approved: true, status: true, createdBy: actor.id });
  channel = await Channel.create({ name: 'QA Walking Tours', description: prefix, apiKey: '', apiSecret: '', createdBy: actor.id, paymentMethodId: method.id });
  product = await Product.create({ name: 'QA City Pub Crawl', price: 100, productTypeId: (await Product.findOne()).productTypeId, createdBy: actor.id, status: true, storefrontConfig: { dateRequired: true, timeMode: 'select', startTimes: ['17:00', '19:30'], minParticipants: 1, maxParticipants: 50, content: { meetingPoint: { name: 'City Square' } } } });
  partner = await PartnerProfile.create({ channelId: channel.id, publicCode: opaqueToken(), name: 'QA Walking Tours', createdBy: actor.id, agreement: { ...defaultAgreement, productIds: [product.id], commissionPercent: 20, paymentModes: ['platform', 'arrival'] } });
  await PartnerMember.create({ partnerId: partner.id, userId: user.id, role: 'owner', active: true });
  const response = await fetch('http://localhost:3001/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.username, password }) });
  assert.equal(response.status, 200, `Local QA login returned ${response.status}`);
  const auth = (await response.json())[0].token;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) void request.continue();
    else void request.abort();
  });
  await page.evaluateOnNewDocument(token => localStorage.setItem('authToken', token), auth);
  await page.setCookie({ name: 'token', value: auth, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/partners', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('Confirmed booking value'), { timeout: 60000 });
  checks.push('Authenticated partner portal');
  async function tab(label) {
    const button = await page.$(`[role="tab"][data-value="${label}"]`);
    if (button) await button.click();
    else await page.evaluate(text => { [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === text)?.click(); }, label);
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Portal overflows at ${width}`);
    checks.push(`Portal responsive ${width}`);
    if (width === 390) await page.screenshot({ path: join(output, 'portal-mobile.png'), fullPage: true });
  }
  await tab('New booking');
  await page.waitForFunction(() => document.body.innerText.includes('Create a booking'));
  assert.ok(await page.$('input[type="date"]'));
  await page.screenshot({ path: join(output, 'booking-mobile.png'), fullPage: true });
  checks.push('Booking form and configured times');
  await tab('Integrations');
  await page.waitForFunction(() => document.body.innerText.includes('API credentials'));
  assert.ok(await page.$('textarea'));
  checks.push('Integration links, embeds and API controls');
  await tab('Activity');
  await page.waitForFunction(() => document.body.innerText.includes('No activity recorded yet.'));
  checks.push('Scoped activity history and empty state');
  await page.goto(`http://localhost:3001/api/partner-sales/${partner.publicCode}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.line');
  for (const width of [1440, 390, 320]) {
    await page.setViewport({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Widget overflows at ${width}`);
    checks.push(`Customer booking form responsive ${width}`);
  }
  await page.screenshot({ path: join(output, 'customer-mobile.png'), fullPage: true });
  const publicCatalog = await (await fetch(`http://localhost:3001/api/partner-sales/${partner.publicCode}/catalog`)).json();
  assert.deepEqual(publicCatalog.products.map(p => p.id), [product.id]);
  assert.equal(publicCatalog.agreement, undefined);
  checks.push('Public catalog contains only approved products and no agreement');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ checks, browserErrors: failures, screenshots: output }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'browser-failure.png'), fullPage: true });
    console.log(JSON.stringify(await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 2).slice(-12).map(e => ({ tag: e.tagName, className: e.className, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width })) }))));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (partner) { await PartnerMember.destroy({ where: { partnerId: partner.id } }); await partner.destroy(); }
  if (product) await product.destroy();
  if (channel) await channel.destroy();
  if (user) { await sequelize.query('DELETE FROM auth_sessions WHERE actor_id = :id', { replacements: { id: user.id } }); await user.destroy(); }
  await sequelize.close();
}
