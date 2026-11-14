// Local actual-page regression. Financial records are read only; never submit a form.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import sequelize from '../src/config/database.ts';
import { defineAssociations } from '../src/models/defineAssociations.ts';
import User from '../src/models/User.ts';
import UserType from '../src/models/UserType.ts';

assert.equal(process.env.FINANCE_LAYOUT_BROWSER_TEST, 'true');
assert.equal(process.env.NODE_ENV, 'development');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST));
assert.equal(process.env.DISABLE_OUTBOUND_EMAIL, 'true');
assert.equal(process.env.DISABLE_BACKGROUND_JOBS, 'true');
const require = createRequire(new URL('../package.json', import.meta.url));
const puppeteer = require('puppeteer');
const output = join(process.env.USERPROFILE, '.omnilodge-local', 'ingestion-finance-stability');
await mkdir(output, { recursive: true });
defineAssociations();
let browser, page, user;
const errors = [], checks = [], requests = [];
try {
  const actor = await User.findOne({ order: [['id', 'ASC']] });
  const role = await UserType.findOne({ where: { slug: 'admin' } });
  const prefix = 'finance-layout-' + randomUUID();
  const password = randomBytes(32).toString('hex');
  user = await User.create({ username: prefix, email: prefix + '@example.invalid', firstName: 'Layout', lastName: 'QA',
    password: await bcrypt.hash(password, 10), userTypeId: role.id, roleKey: 'admin', badgeRequired: false,
    profilePhotoUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    approved: true, status: true, createdBy: actor.id });
  const login = await fetch('http://localhost:3001/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.username, password }) });
  assert.equal(login.status, 200); const token = (await login.json())[0].token;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/')) requests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) return void request.abort();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      // UI telemetry is observed directly below; no application writes are allowed.
      return void request.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
    void request.continue();
  });
  await page.evaluateOnNewDocument(auth => {
    localStorage.setItem('authToken', auth);
    const NativeResizeObserver = window.ResizeObserver;
    window.__layoutEvents = []; window.__resizeErrors = [];
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback) {
        const registration = new Error().stack;
        super((entries, observer) => {
          const targets = entries.map(entry => ({ tag: entry.target.tagName, className: entry.target.className,
            text: entry.target.classList.contains('mantine-Tooltip-tooltip') ? entry.target.textContent : undefined,
            size: [entry.contentRect.width, entry.contentRect.height] }));
          const before = entries.map(entry => { const box = entry.target.getBoundingClientRect(); return [box.width, box.height]; });
          callback(entries, observer);
          const after = entries.map(entry => { const box = entry.target.getBoundingClientRect(); return [box.width, box.height]; });
          window.__layoutEvents.push({ at: performance.now(), registration, targets, before, after });
          if (window.__layoutEvents.length > 40) window.__layoutEvents.shift();
        });
      }
    };
    window.addEventListener('error', event => {
      if (/ResizeObserver/.test(event.message)) window.__resizeErrors.push({ message: event.message, at: performance.now(),
        events: window.__layoutEvents.filter(item => performance.now() - item.at < 250).slice(-15) });
    });
  }, token);
  await page.setCookie({ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.setViewport({ width: 1536, height: 695, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:3000/finance/transactions', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('New transaction'), { timeout: 60000 });
  async function close() {
    await page.evaluate(() => [...document.querySelectorAll('button[aria-label="Close dialog"]')].find(el => el.checkVisibility()).click());
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].some(el => el.checkVisibility()));
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('transactionModal'));
    await page.waitForNetworkIdle({ idleTime: 300 });
  }
  for (const width of [1536, 1440, 768, 390, 320]) {
    await page.setViewport({ width, height: width >= 768 ? 695 : 956, deviceScaleFactor: width >= 768 ? 1.25 : 2 });
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator('::-p-aria(New transaction)').click();
      const amount = await page.waitForSelector('[role="dialog"] input[aria-label="Transaction amount"]', { visible: true });
      await new Promise(resolve => setTimeout(resolve, 220));
      await amount.click({ clickCount: 3 }); await amount.type('120.45');
      await page.keyboard.press('Tab');
      await page.evaluate(() => { const inputs = [...document.querySelectorAll('[role="dialog"] input')];
        const input = inputs.find(el => el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.includes('Account'));
        input?.click(); });
      await page.keyboard.press('Escape');
      await close();
    }
    const editLabel = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Edit transaction "]')]
      .find(el => el.checkVisibility())?.getAttribute('aria-label'));
    assert.ok(editLabel, `An editable local fixture must be visible at ${width}`);
    if (editLabel) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const button = await page.$(`button[aria-label="${editLabel}"]`);
        // Flex/grid parents blockify inline-flex to computed "flex" on cards.
        assert.equal(await button.evaluate(el => el.parentElement.style.display), 'inline-flex', 'Browser must load the corrected tooltip reference');
        await button.hover();
        await new Promise(resolve => setTimeout(resolve, 500));
        await page.evaluate(label => [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label)?.click(), editLabel);
        await page.waitForFunction(() => new URLSearchParams(location.search).get('transactionModal') === 'edit');
        await page.waitForSelector('[role="dialog"] input[aria-label="Transaction amount"]', { visible: true });
        await page.waitForNetworkIdle({ idleTime: 300 });
        await close();
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Page overflow at ${width}`);
    checks.push({ width, createCycles: 3, editCycles: editLabel ? 3 : 0 });
    console.log(JSON.stringify(checks.at(-1)));
  }
  const layout = await page.evaluate(() => ({ resizeErrors: window.__resizeErrors, recent: window.__layoutEvents }));
  await writeFile(join(output, 'finance-layout-browser.json'), JSON.stringify({ checks, errors, ...layout }, null, 2), 'utf8');
  console.log(JSON.stringify({ checks, pageErrors: errors, resizeErrorCount: layout.resizeErrors.length }));
  assert.equal(layout.resizeErrors.length, 0, 'ResizeObserver loop detected; callback traces saved privately.');
  assert.deepEqual(errors, []);
} finally {
  if (page) await writeFile(join(output, 'finance-layout-progress.json'), JSON.stringify({ checks, errors, requests,
    page: await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 700), resizeErrors: window.__resizeErrors, recent: window.__layoutEvents })) }, null, 2), 'utf8').catch(() => {});
  if (page) await page.screenshot({ path: join(output, 'finance-layout-last.png'), fullPage: true }).catch(() => {});
  if (browser) await browser.close();
  if (user) { await sequelize.query('DELETE FROM auth_sessions WHERE actor_id = :id', { replacements: { id: user.id } }); await user.destroy(); }
  await sequelize.close();
}
