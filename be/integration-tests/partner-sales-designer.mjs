// Explicitly local-only: temporary partner/user, no orders, no Stripe requests.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import db from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import UserType from '../src/models/UserType.ts';
import Channel from '../src/models/Channel.ts';
import PaymentMethod from '../src/models/PaymentMethod.ts';
import { PartnerProfile, PartnerMember, PartnerEvent, PartnerBooking } from '../src/models/Partner.ts';
import { defaultAgreement, opaqueToken } from '../src/services/partners/partnerPolicy.ts';
import { localPartnerLogoDirectory } from '../src/services/storefrontMediaService.ts';
assert.equal(process.env.NODE_ENV, 'development');
assert.ok(['localhost', '127.0.0.1'].includes(process.env.DB_HOST));
assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
defineAssociations();
const puppeteer = createRequire(new URL('../package.json', import.meta.url))('puppeteer');
const output = join(process.env.USERPROFILE, '.omnilodge-local/partner-storefront-design');
await mkdir(output, { recursive: true });
let user, channel, partner, member, browser, page, logoFile;
const checks = [], errors = [];
try {
  const actor = await User.findOne(), role = await UserType.findOne({ where: { slug: 'partner' } }), method = await PaymentMethod.findOne();
  const username = `designer-${randomUUID()}`, password = randomBytes(24).toString('hex');
  user = await User.create({ username, email: `${username}@example.invalid`, firstName: 'Designer', lastName: 'QA', password: await bcrypt.hash(password, 10), userTypeId: role.id, roleKey: 'guide', badgeRequired: false, profilePhotoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', approved: true, status: true, createdBy: actor.id });
  channel = await Channel.create({ name: 'QA Page Designer', description: username, apiKey: '', apiSecret: '', createdBy: actor.id, paymentMethodId: method.id });
  partner = await PartnerProfile.create({ channelId: channel.id, publicCode: opaqueToken(), name: 'QA Page Designer', createdBy: actor.id, agreement: { ...defaultAgreement, productIds: [28, 48], allowedOrigins: ['http://localhost:3000'] } });
  member = await PartnerMember.create({ partnerId: partner.id, userId: user.id, role: 'owner', active: true });
  const login = await fetch('http://localhost:3001/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: username, password }) });
  assert.equal(login.status, 200); const auth = (await login.json())[0].token;
  const privateBase = `http://localhost:3001/api/partners/${partner.id}/sales-page`, publicBase = `http://localhost:3001/api/partner-sales/${partner.publicCode}`;
  const headers = { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' };
  let response = await fetch(privateBase, { headers }); assert.equal(response.status, 200); let config = await response.json();
  await member.update({ role: 'agent' }); assert.equal((await fetch(privateBase, { headers })).status, 403);
  await member.update({ role: 'developer' }); assert.equal((await fetch(privateBase, { headers })).status, 200);
  await member.update({ role: 'owner' }); checks.push('Owner and developer access; agent denied');
  const logo = await sharp({ create: { width: 480, height: 160, channels: 4, background: { r: 255, g: 22, b: 143, alpha: 0.5 } } }).png().toBuffer();
  const upload = new FormData(); upload.append('logo', new Blob([logo], { type: 'image/png' }), 'logo.png');
  response = await fetch(`${privateBase}/logo`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: upload });
  assert.equal(response.status, 201); const { url: logoUrl } = await response.json();
  assert.ok(logoUrl.startsWith('http://localhost:3001/api/partner-sales/local-logos/'));
  logoFile = join(localPartnerLogoDirectory, new URL(logoUrl).pathname.split('/').pop());
  const logoResponse = await fetch(logoUrl); assert.equal(logoResponse.status, 200);
  const logoMeta = await sharp(Buffer.from(await logoResponse.arrayBuffer())).metadata(); assert.equal(logoMeta.format, 'webp'); assert.equal(logoMeta.hasAlpha, true);
  const invalid = new FormData(); invalid.append('logo', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'bad.svg');
  assert.equal((await fetch(`${privateBase}/logo`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: invalid })).status, 400);
  checks.push('Real logo upload re-encodes WebP locally, preserves alpha and rejects SVG');
  const defaults = { showBrand: true, brandDisplay: 'logo', logoUrl, showPoweredBy: false, showStepper: false, title: 'Your next great night', showEyebrow: false, showDescription: false, showEmailTrust: false, paymentTrustText: 'Pay securely online', partnerTrustText: 'Chosen by {partnerName}' };
  const payload = { version: config.version, reason: 'Local page designer verification', defaults, links: [
    { name: 'Food form', active: true, overrides: { entryMode: 'product', entryProductId: 48, productIds: [48] } },
    { name: 'Single crawl card', active: true, overrides: { productIds: [28], entryMode: 'catalog' } },
    { name: 'Disabled', active: false, overrides: {} },
  ] };
  response = await fetch(privateBase, { method: 'PUT', headers, body: JSON.stringify(payload) }); assert.equal(response.status, 200); config = await response.json();
  assert.equal(config.version, payload.version + 1); assert.equal(config.links.length, 3);
  assert.equal((await fetch(privateBase, { method: 'PUT', headers, body: JSON.stringify(payload) })).status, 409);
  assert.ok(await PartnerEvent.findOne({ where: { partnerId: partner.id, type: 'sales_page.updated', actorId: user.id } }));
  checks.push('Version conflict preserves changes and writes actor/reason audit');
  const direct = config.links[0], single = config.links[1], disabled = config.links[2];
  for (const suffix of [`?link=${disabled.code}`, '?link=not-valid', `?link=${'x'.repeat(43)}`]) assert.equal((await fetch(publicBase + suffix)).status, 404);
  response = await fetch(`${publicBase}/catalog?link=${direct.code}`); const catalog = await response.json();
  assert.deepEqual(catalog.products.map(p => p.id), [48]); assert.equal(catalog.links, undefined); assert.equal(catalog.agreement, undefined);
  assert.equal((await fetch(`${publicBase}/availability?link=${direct.code}&productId=28&month=2032-01`)).status, 404);
  const booking = { reference: 'restricted-link', paymentMode: 'platform', customer: { firstName: 'QA', lastName: 'Only', email: 'qa@example.invalid' }, items: [{ productId: 28, quantity: 1, experienceDate: '2032-01-01', experienceTime: '21:00' }] };
  for (const action of ['quote', 'book']) assert.equal((await fetch(`${publicBase}/${action}?link=${direct.code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(booking) })).status, 403);
  assert.equal(await PartnerBooking.count({ where: { partnerId: partner.id } }), 0);
  assert.equal((await fetch(`${publicBase}/qr?link=${direct.code}`)).headers.get('content-type'), 'image/png');
  checks.push('Saved links restrict catalog, calendar, quote and book; disabled links fail closed; QR works');
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] }); page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => { const url = new URL(request.url()); if (['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) void request.continue(); else void request.abort(); });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(publicBase, { waitUntil: 'networkidle2' }); await page.waitForSelector('.activity-card');
  assert.equal(await page.$eval('.intro h1', el => el.textContent), defaults.title);
  assert.equal(await page.$('.intro .eyebrow'), null); assert.equal(await page.$('.intro-description'), null);
  assert.equal(await page.$eval('.powered', el => el.checkVisibility()), false); assert.equal(await page.$eval('.progress', el => el.checkVisibility()), false);
  assert.equal(await page.$eval('.partner-logo', el => el.naturalWidth > 0), true);
  assert.equal(await page.$eval('.footer', el => el.innerText), 'Pay securely online\nChosen by QA Page Designer');
  checks.push('Independent intro, logo, Powered by, stepper and footer controls render accurately');
  await page.goto(single.url, { waitUntil: 'networkidle2' }); await page.waitForSelector('.activity-card');
  assert.equal(await page.$('.catalog-count'), null); assert.equal((await page.$$('.activity-card')).length, 1);
  checks.push('One experience can retain the selection step and hide its count');
  config.links[1].overrides = { ...config.links[1].overrides, hideSingleCount: false };
  response = await fetch(privateBase, { method: 'PUT', headers, body: JSON.stringify({ ...config, reason: 'Verify singular count override' }) }); assert.equal(response.status, 200); config = await response.json();
  await page.goto(single.url, { waitUntil: 'networkidle2' }); await page.waitForSelector('.catalog-count');
  assert.equal(await page.$eval('.catalog-count', el => el.textContent), '1 experience to explore');
  config.links[1].overrides = { ...config.links[1].overrides, entryMode: 'single' };
  response = await fetch(privateBase, { method: 'PUT', headers, body: JSON.stringify({ ...config, reason: 'Verify automatic single-experience form' }) }); assert.equal(response.status, 200); config = await response.json();
  await page.goto(single.url, { waitUntil: 'networkidle2' }); await page.waitForSelector('.ktk-booking');
  assert.equal(await page.$('.activity-card'), null);
  assert.equal(await page.$eval('body', el => el.dataset.stage), 'configure');
  checks.push('Singular count can be explicitly shown; automatic single-experience mode opens form');
  await page.goto(direct.url, { waitUntil: 'networkidle2' }); await page.waitForSelector('.source-food');
  assert.equal(await page.$('.activity-card'), null); assert.equal(await page.$eval('body', el => el.dataset.stage), 'configure');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Direct form overflow at ${width}`);
  }
  checks.push('Saved specific-experience link opens the correct form directly across four widths');
  await page.evaluateOnNewDocument(token => localStorage.setItem('authToken', token), auth);
  await page.setCookie({ name: 'token', value: auth, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.goto('http://localhost:3000/partners', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some(el => el.textContent === 'Integrations'));
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === 'Integrations').click());
  await page.waitForFunction(() => document.body.innerText.includes('Booking page designer'));
  await page.waitForFunction(() => document.body.innerText.includes('Partner identity'));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Designer overflow at ${width}`);
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === 'Introduction').click());
  await page.waitForFunction(() => [...document.querySelectorAll('label')].some(el => el.textContent === 'Headline text'));
  const titleId = await page.evaluate(() => [...document.querySelectorAll('label')].find(el => el.textContent === 'Headline text')?.htmlFor);
  assert.ok(titleId); await page.locator(`#${titleId}`).fill('A custom draft headline');
  await page.locator('button ::-p-text(Preview draft)').click();
  await page.waitForSelector('iframe[title="Booking page draft preview"]');
  const iframe = await page.$('iframe[title="Booking page draft preview"]'); const preview = await iframe.contentFrame();
  await preview.waitForFunction(() => document.querySelector('.intro h1')?.textContent === 'A custom draft headline', { timeout: 30000 });
  await page.screenshot({ path: join(output, 'designer-draft-preview.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal((await (await fetch(privateBase, { headers })).json()).defaults.title, defaults.title);
  checks.push('Actual editor previews unsaved design without modifying saved settings');
  const reasonId = await page.evaluate(() => [...document.querySelectorAll('label')].find(el => el.textContent === 'Reason for change').htmlFor);
  await page.locator(`#${reasonId}`).fill('Actual UI save verification');
  const saveResponse = page.waitForResponse(res => res.url() === privateBase && res.request().method() === 'PUT');
  await page.locator('button ::-p-text(Save page settings)').click(); assert.equal((await saveResponse).status(), 200);
  await page.waitForFunction(() => document.body.innerText.includes('Page settings saved.'));
  assert.equal((await (await fetch(privateBase, { headers })).json()).defaults.title, 'A custom draft headline');
  checks.push('Actual editor persists audited defaults and retains saved links');
  await page.locator('button ::-p-text(New link)').click();
  await page.waitForFunction(() => [...document.querySelectorAll('label')].some(el => el.textContent === 'Link name (internal)'));
  const nameId = await page.evaluate(() => [...document.querySelectorAll('label')].find(el => el.textContent === 'Link name (internal)').htmlFor);
  await page.locator(`#${nameId}`).fill('Created in the editor');
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === 'Experiences').click());
  await page.waitForFunction(() => document.body.innerText.includes('Where customers start'));
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('p')].find(el => el.textContent === 'Where customers start');
    title.parentElement.parentElement.querySelector('input[type="checkbox"]').click();
  });
  async function selectField(label, text) {
    const fieldId = await page.evaluate(name => [...document.querySelectorAll('label')].find(el => el.textContent === name)?.htmlFor, label);
    assert.ok(fieldId); await page.locator(`#${fieldId}`).click();
    await page.waitForFunction(value => [...document.querySelectorAll('[role="option"]')].some(el => el.checkVisibility() && el.textContent === value), {}, text);
    await page.evaluate(value => [...document.querySelectorAll('[role="option"]')].find(el => el.checkVisibility() && el.textContent === value).click(), text);
  }
  await selectField('First screen', 'Booking form for a specific experience');
  await selectField('Experience to open', 'Food Tour Krakow');
  await page.locator(`#${reasonId}`).fill('Create an experience-specific link in the UI');
  const createResponse = page.waitForResponse(res => res.url() === privateBase && res.request().method() === 'PUT');
  await page.locator('button ::-p-text(Save page settings)').click(); assert.equal((await createResponse).status(), 200);
  const after = await (await fetch(privateBase, { headers })).json(), created = after.links.find(row => row.name === 'Created in the editor');
  assert.ok(created?.url); assert.deepEqual(created.overrides, { entryMode: 'product', entryProductId: 48 });
  assert.equal(created.overrides.title, undefined);
  checks.push('Actual editor creates a shareable direct-form link with inherited branding');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ checks, browserErrors: errors, noBookingsCreated: true, screenshots: output }, null, 2));
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'designer-failure.png'), fullPage: true }); console.log((await page.$eval('body', el => el.innerText)).slice(-3500)); }
  throw error;
} finally {
  if (browser) await browser.close();
  if (partner) { await PartnerEvent.destroy({ where: { partnerId: partner.id } }); await PartnerMember.destroy({ where: { partnerId: partner.id } }); await partner.destroy(); }
  if (channel) await channel.destroy();
  if (user) { await db.query('DELETE FROM auth_sessions WHERE actor_id = :id', { replacements: { id: user.id } }); await user.destroy(); }
  if (logoFile) await unlink(logoFile);
  await db.close();
}
