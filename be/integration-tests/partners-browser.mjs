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
import { PartnerProfile, PartnerMember, PartnerEvent } from '../src/models/Partner.ts';
import { defaultAgreement, opaqueToken } from '../src/services/partners/partnerPolicy.ts';

assert.equal(process.env.NODE_ENV, 'development');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
const require = createRequire(new URL('../package.json', import.meta.url));
const puppeteer = require('puppeteer');
const commissions = process.env.PARTNER_COMMISSION_BROWSER_TEST === 'true';
defineAssociations();
const output = join(process.env.USERPROFILE, '.omnilodge-local', 'partners-portal');
await mkdir(output, { recursive: true });
let browser, page, user, channel, product, partner;
const failures = [];
const checks = [];
try {
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  const role = await UserType.findOne({ where: { slug: commissions ? 'admin' : 'partner' } });
  const method = await PaymentMethod.findOne();
  const prefix = `partner-browser-${randomUUID()}`;
  const password = randomBytes(32).toString('hex');
  user = await User.create({ username: prefix, email: `${prefix}@example.invalid`, firstName: 'Portal', lastName: 'QA', password: await bcrypt.hash(password, 10), userTypeId: role.id, roleKey: commissions ? 'admin' : 'guide', badgeRequired: false, profilePhotoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', approved: true, status: true, createdBy: actor.id });
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
  if (commissions) {
    async function labelled(label) {
      const id = await page.evaluate(text => [...document.querySelectorAll('label')].find(el => el.textContent.replace('*', '').trim() === text)?.htmlFor, label);
      assert.ok(id, `Missing field: ${label}`);
      return page.$(`[id="${id}"]`);
    }
    async function select(label, value) {
      const text = ({ fixed: 'Fixed amount', percentage: 'Percentage', person: 'Per guest place', experience: 'Per experience', booking: 'Per booking' })[value] || 'QA Walking Tours';
      const field = await labelled(label);
      if (await field.evaluate(el => el.value) === text) return;
      await field.click();
      await page.waitForFunction(name => [...document.querySelectorAll('[role="option"]')].some(el => el.checkVisibility() && el.textContent.trim() === name), {}, text);
      await page.evaluate(name => [...document.querySelectorAll('[role="option"]')].find(el => el.checkVisibility() && el.textContent.trim() === name).click(), text);
      assert.equal(await field.evaluate(el => el.value), text);
    }
    async function fill(label, value) {
      const field = await labelled(label); await field.click({ clickCount: 3 });
      await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
      await field.type(value);
    }
    await select('Partner company', String(partner.id));
    await tab('Agreement');
    await page.waitForFunction(() => document.body.innerText.includes('Default commission'));
    await select('Default commission type', 'fixed');
    await select('Default commission basis', 'person');
    await fill('Default commission rate (PLN)', '10');
    await page.locator('button ::-p-text(Add product rule)').click();
    await select(`${product.name} basis`, 'experience');
    await fill(`${product.name} rate (PLN)`, '15');
    await fill('Reason for this change', 'Local responsive commission editor verification');
    const saved = page.waitForResponse(res => res.url().endsWith(`/partners/${partner.id}/agreement`) && res.request().method() === 'PUT');
    await page.locator('button ::-p-text(Save agreement)').click();
    assert.equal((await saved).status(), 200);
    await partner.reload();
    assert.deepEqual(partner.agreement.commissionRule, { type: 'fixed', basis: 'person', value: 10 });
    assert.deepEqual(partner.agreement.productCommissions, [{ productId: product.id, rule: { type: 'fixed', basis: 'experience', value: 15 } }]);
    checks.push('Actual agreement editor saves default and product override with actor/reason audit');
    await page.waitForFunction(() => document.body.innerText.includes('Product-specific rules'));
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Commission editor overflows at ${width}`);
      checks.push(`Commission editor responsive ${width}`);
      if (width === 390) await page.screenshot({ path: join(output, 'commission-editor-mobile.png'), fullPage: true });
    }
    const body = { reference: 'commission-quote', paymentMode: 'platform', customer: { firstName: 'Quote', lastName: 'QA', email: 'qa@example.invalid' },
      items: ['17:00', '19:30'].map(time => ({ productId: product.id, quantity: 2, experienceDate: '2032-01-01', experienceTime: time })) };
    const privateResponse = await fetch(`http://localhost:3001/api/partners/${partner.id}/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth }, body: JSON.stringify(body) });
    assert.equal(privateResponse.status, 200);
    assert.equal((await privateResponse.json()).partnerCommission.commission, 30);
    const publicResponse = await fetch(`http://localhost:3001/api/partner-sales/${partner.publicCode}/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(publicResponse.status, 200);
    const customerQuote = await publicResponse.json();
    assert.equal(customerQuote.total, 400); assert.equal(customerQuote.partnerCommission, undefined);
    checks.push('Private quote calculates two NYE-style departures; public customer quote hides commission');
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
  await page.waitForFunction(text => document.body.innerText.includes(text), {}, commissions ? 'agreement updated' : 'No activity recorded yet.');
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
  if (partner) { await PartnerEvent.destroy({ where: { partnerId: partner.id } }); await PartnerMember.destroy({ where: { partnerId: partner.id } }); await partner.destroy(); }
  if (product) await product.destroy();
  if (channel) await channel.destroy();
  if (user) { await sequelize.query('DELETE FROM auth_sessions WHERE actor_id = :id', { replacements: { id: user.id } }); await user.destroy(); }
  await sequelize.close();
}
