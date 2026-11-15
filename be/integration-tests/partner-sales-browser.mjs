// Explicit local review regression. Quotes use the real local API; booking and
// Stripe requests are intercepted so no orders, email or payments are created.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

assert.equal(process.env.PARTNER_SALES_BROWSER_TEST, 'true');
const url = new URL(process.env.PARTNER_SALES_PREVIEW_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Local preview only.');
assert.match(url.pathname, /^\/api\/partner-sales\/[A-Za-z0-9_-]{43}$/);
const require = createRequire(new URL('../package.json', import.meta.url));
const puppeteer = require('puppeteer');
const output = join(process.env.USERPROFILE, '.omnilodge-local', 'partner-storefront-design');
await mkdir(output, { recursive: true });
const catalog = await (await fetch(url.href + '/catalog')).json();
const pub = catalog.products.find(product => product.name === 'Pub Crawl');
const food = catalog.products.find(product => /food.?tour/i.test(product.name));
const nye = catalog.products.find(product => product.config?.startTimes?.includes('17:00') && product.config?.startTimes?.includes('19:30'));
assert.ok(pub && food && nye, 'This opt-in fixture requires the approved Pub Crawl, Food Tour and two-slot NYE products.');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [], writes = [], checks = [];
async function setup(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluateOnNewDocument(() => {
    window.__partnerLayoutErrors = [];
    window.addEventListener('error', event => { if (/ResizeObserver/.test(event.message)) window.__partnerLayoutErrors.push(event.message); });
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith('https://checkout.stripe.com/')) return void request.respond({ status: 200, contentType: 'text/html', body: '<title>Intercepted test checkout</title><p>Test handoff only. No payment was created.</p>' });
    if (request.method() === 'POST' && request.url() === url.href + '/book') {
      writes.push(JSON.parse(request.postData()));
      return void request.respond({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_design_preview', status: 'pending_payment' }) });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && request.url() !== url.href + '/quote') return void request.abort();
    return void request.continue();
  });
}
async function noOverflow(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' overflows horizontally');
  assert.deepEqual(await page.evaluate(() => window.__partnerLayoutErrors), [], label + ' native ResizeObserver error');
  checks.push(label);
}
async function contacts(page) {
  await page.select('select[name="phoneCountry"]', 'GB');
  for (const [key, value] of Object.entries({ fullName: 'Alex Preview', email: 'preview@example.invalid', phone: '7700900123' })) {
    await page.$eval('input[name="' + key + '"]', (input, text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  }
}
async function clickVisible(page, selector) {
  const target = await page.$(selector);
  await target.scrollIntoView();
  // A tall storefront configurator is sticky on desktop. A single automatic
  // scroll may move its parent rather than the button; use real wheel input as
  // a customer would, and still require a visible native pointer click.
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = await target.boundingBox(), height = await page.evaluate(() => innerHeight);
    if (box && box.y >= 0 && box.y + box.height <= height) return target.click();
    await page.mouse.wheel({ deltaY: box && box.y < 0 ? -600 : 600 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  throw new Error('The submit button cannot be reached by scrolling.');
}
try {
  for (const width of [1440, 1000, 768, 390, 320]) {
    const page = await browser.newPage(); await setup(page);
    await page.setViewport({ width, height: width < 768 ? 956 : 1000, deviceScaleFactor: 1 });
    await page.goto(url.href, { waitUntil: 'networkidle2' }); await page.waitForSelector('.activity-card');
    assert.deepEqual(await page.$$eval('.activity-card', cards => cards.map(card => Number(card.dataset.productId))), catalog.products.map(product => product.id));
    assert.equal(await page.$eval('.catalog-grid', grid => grid.innerText.includes('MAIN PRODUCT')), false);
    await page.evaluate(() => document.fonts.ready);
    const palette = await page.evaluate(() => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      return { page: rgb(getComputedStyle(document.body).backgroundColor), cards: [...document.querySelectorAll('.activity-card')].map(card => {
        const button = card.querySelector('.button');
        return { background: rgb(getComputedStyle(card).backgroundColor), foreground: rgb(getComputedStyle(card.querySelector('.card-title')).color), button: rgb(getComputedStyle(button).backgroundColor), buttonText: rgb(getComputedStyle(button).color) };
      }) };
    });
    const luminance = channels => channels.map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (first, second) => (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05);
    assert.ok(palette.page.every(value => value < 50), 'The activity chooser should use its dark theme');
    palette.cards.forEach(card => { assert.ok(card.background.every(value => value < 50), 'Each activity card should use a dark surface'); assert.ok(contrast(card.foreground, card.background) >= 4.5); assert.ok(contrast(card.buttonText, card.button) >= 4.5, 'Booking button text needs readable contrast'); });
    await noOverflow(page, 'catalog-' + width);
    if ([1440, 390].includes(width)) await page.screenshot({ path: join(output, 'catalog-' + width + '.png'), fullPage: true });
    await page.click('button[aria-label="Book ' + food.name + '"]');
    assert.equal(await page.$eval('body', body => body.dataset.theme), 'food');
    assert.equal(await page.$eval('.food-tour-heading h1', element => getComputedStyle(element).fontFamily.includes('Fraunces')), true);
    assert.deepEqual(await page.$$eval('#booking-form input:not([type="hidden"])', elements => elements.filter(element => element.name && element.type !== 'search').map(element => element.name)), ['fullName', 'email', 'phone']);
    assert.ok(await page.$('.food-booking-summary'));
    await noOverflow(page, 'food-form-' + width);
    if ([1440, 390].includes(width)) await page.screenshot({ path: join(output, 'food-' + width + '.png'), fullPage: true });
    await page.evaluate(() => [...document.querySelectorAll('.back-row button')].find(element => element.textContent.includes('All experiences')).click());
    await page.click('button[aria-label="Book ' + pub.name + '"]');
    assert.equal(await page.$eval('body', body => body.dataset.theme), 'ktk');
    assert.equal(await page.$eval('.panel-heading', element => getComputedStyle(element).fontFamily.includes('Oswald')), true);
    await page.click('button[aria-label="Choose activity date for ' + pub.name + '"]');
    await page.waitForSelector('.calendar-day:not(:disabled)');
    await noOverflow(page, 'pub-calendar-' + width);
    const date = await page.$$eval('.calendar-day:not(:disabled)', elements => (elements.find(element => new Date(element.dataset.date + 'T12:00:00Z').getUTCDay() === 0) || elements[0]).dataset.date);
    await page.click('button[data-date="' + date + '"]');
    assert.equal(await page.$('.calendar'), null, 'Selecting a date must close the popup');
    await page.select('select[aria-label="Men for ' + pub.name + '"]', '2');
    await page.select('select[aria-label="Women for ' + pub.name + '"]', '1');
    const shirts = pub.addons.find(addon => addon.inventory?.variantSelectionRequired);
    const photos = pub.addons.find(addon => addon.config?.selectionMode === 'options');
    assert.ok(shirts && photos);
    await page.select('[data-addon-id="' + shirts.id + '"] > .storefront-select > select', '2');
    const size = shirts.inventory.variants.find(variant => variant.inStock && variant.availableQuantity >= 2);
    await page.select('select[aria-label="' + shirts.name + ' size ' + size.label + '"]', '2');
    const option = photos.config.options.find(value => value.value === '3') || photos.config.options[0];
    await page.select('select[aria-label="' + photos.name + ' option"]', option.value);
    await contacts(page); await noOverflow(page, 'pub-form-' + width);
    if ([1440, 390].includes(width)) await page.screenshot({ path: join(output, 'pub-' + width + '.png'), fullPage: true });
    try { await clickVisible(page, '#booking-form button[type="submit"]'); } catch (error) {
      await writeFile(join(output, 'submit-layout-diagnostic.json'), JSON.stringify(await page.evaluate(() => {
        const element = document.querySelector('#booking-form button[type="submit"]');
        const rect = el => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
        return { scroll: scrollY, viewport: [innerWidth, innerHeight], button: element?.outerHTML, parents: [...(function* () { let el = element; while (el) { const style = getComputedStyle(el); yield { tag: el.tagName, class: el.className, box: rect(el), overflow: style.overflow, position: style.position, display: style.display }; el = el.parentElement; } })()] };
      }), null, 2));
      await page.screenshot({ path: join(output, 'submit-layout-failure.png') }); throw error;
    }
    try { await page.waitForSelector('.review-heading', { timeout: 15000 }); } catch (error) { throw new Error('Quote failed at ' + width + ': ' + await page.$eval('#feedback', element => element.textContent), { cause: error }); }
    await noOverflow(page, 'review-' + width);
    assert.ok(await page.$eval('.review-contact', element => element.innerText.includes('preview@example.invalid')));
    if ([1440, 390].includes(width)) await page.screenshot({ path: join(output, 'review-' + width + '.png'), fullPage: true });
    if (width === 1440) {
      await page.$eval('input[name="discountCode"]', input => { input.value = 'DRAFT'; input.dispatchEvent(new Event('input', { bubbles: true })); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });
      const before = writes.length;
      await page.click('.review-actions button'); await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('review the total'));
      assert.equal(writes.length, before, 'An edited cart must be re-quoted and reviewed before any booking request');
      checks.push('cart-edit-requotes-before-payment');
      await page.click('.review-actions button'); await page.waitForFunction(() => location.hostname === 'checkout.stripe.com');
      const payload = writes.at(-1);
      assert.equal(payload.paymentMode, 'platform');
      assert.equal(payload.items.length, 1); assert.equal(payload.items[0].productId, pub.id); assert.equal(payload.items[0].quantity, 3);
      assert.deepEqual(payload.items[0].options.participants, { men: 2, women: 1 });
      assert.equal(payload.items[0].addons.find(value => value.addonId === photos.id).value, option.value);
      assert.deepEqual(payload.items[0].addons.find(value => value.addonId === shirts.id).variants, [{ value: size.value, quantity: 2 }]);
      checks.push('checkout-verified-payload-no-real-write');
    }
    await page.close();
  }
  const foodPage = await browser.newPage(); await setup(foodPage); await foodPage.setViewport({ width: 1440, height: 1000 });
  await foodPage.goto(url.href, { waitUntil: 'networkidle2' }); await foodPage.waitForSelector('.activity-card'); await foodPage.click('button[aria-label="Book ' + food.name + '"]');
  const futureDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await foodPage.$eval('input[data-native-date]', (input, date) => { input.value = date; input.dispatchEvent(new Event('change', { bubbles: true })); }, futureDate);
  await contacts(foodPage);
  await foodPage.$eval('input[name="phone"]', input => { input.value = '+390212345678'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await foodPage.$eval('select[name="phoneCountry"]', input => input.value), 'IT');
  assert.equal(await foodPage.$eval('input[name="phone"]', input => input.value), '0212345678', 'Italian landline leading zero must survive international normalization');
  await foodPage.click('button[aria-label="Choose phone country code"]'); await foodPage.type('input[aria-label="Search countries"]', 'Italy');
  await foodPage.click('[role="option"][data-value="IT"]');
  assert.equal(await foodPage.$('[role="listbox"]'), null, 'Selecting a country closes its list');
  await foodPage.click('.notes-toggle'); await foodPage.type('textarea[name^="notes-"]', 'Local preview dietary request');
  const foodRequest = foodPage.waitForRequest(request => request.url() === url.href + '/quote' && request.method() === 'POST');
  await clickVisible(foodPage, 'button[form="booking-form"]');
  const foodPayload = JSON.parse((await foodRequest).postData());
  assert.equal(foodPayload.customer.phone, '+390212345678'); assert.equal(foodPayload.customer.firstName, 'Alex'); assert.equal(foodPayload.customer.lastName, 'Preview');
  assert.equal(foodPayload.items[0].options.notes, 'Local preview dietary request');
  await foodPage.waitForSelector('.review-heading'); checks.push('food-tour-native-date-country-search-phone-and-notes-quote'); await foodPage.close();
  const page = await browser.newPage(); await setup(page); await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(url.href, { waitUntil: 'networkidle2' }); await page.waitForSelector('.activity-card'); await page.click('button[aria-label="Book ' + nye.name + '"]');
  await page.select('select[aria-label="Start time for ' + nye.name + '"]', '17:00');
  await page.select('select[aria-label="Men for ' + nye.name + '"]', '1');
  await contacts(page); await clickVisible(page, '#booking-form button[type="submit"]'); await page.waitForSelector('.review-heading');
  await page.evaluate(() => document.querySelector('.add-experience').click()); await page.click('button[aria-label="Book ' + nye.name + '"]');
  await page.$$eval('select[aria-label^="Start time for "]', elements => { elements[1].value = '19:30'; elements[1].dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$$eval('select[data-gender="women"]', elements => { elements[1].value = '2'; elements[1].dispatchEvent(new Event('change', { bubbles: true })); });
  await contacts(page); await clickVisible(page, '#booking-form button[type="submit"]'); await page.waitForSelector('.review-heading');
  assert.equal(await page.$$('.review-item').then(items => items.length), 2);
  assert.match(await page.$eval('.review-layout', element => element.innerText), /17:00/); assert.match(await page.$eval('.review-layout', element => element.innerText), /19:30/);
  checks.push('distinct-nye-departures-preserved'); await page.close();

  // Exercise the real cross-origin iframe/resize helper without adding a preview
  // route or test fixture to the application. Only this intercepted parent exists.
  const parent = await browser.newPage(); await setup(parent); await parent.setViewport({ width: 390, height: 950 });
  const parentUrl = 'http://localhost:3000/__partner_design_preview';
  parent.removeAllListeners('request');
  parent.on('request', request => {
    if (request.url() === parentUrl) return void request.respond({ status: 200, contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;border:0;width:100%}</style><iframe data-omnilodge-partner src="' + url.href + '?embed=1" height="1000"></iframe><script src="' + url.origin + '/api/partner-sales/embed.js"></script>' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return void request.abort();
    void request.continue();
  });
  await parent.goto(parentUrl, { waitUntil: 'networkidle2' });
  const frame = await (await parent.$('iframe')).contentFrame(); await frame.waitForSelector('.activity-card');
  await parent.waitForFunction(() => Number.parseInt(document.querySelector('iframe').style.height) > 1100);
  await frame.click('button[aria-label="Book ' + food.name + '"]'); await frame.waitForSelector('.food-checkout-form');
  await new Promise(resolve => setTimeout(resolve, 350));
  const rootHeight = await frame.$eval('#partner-sales', element => Math.ceil(element.getBoundingClientRect().height));
  const iframeHeight = await parent.$eval('iframe', element => Number.parseInt(element.style.height));
  assert.ok(Math.abs(rootHeight - iframeHeight) < 4, 'Iframe height did not follow the selected form');
  assert.deepEqual(await frame.evaluate(() => window.__partnerLayoutErrors), []); await noOverflow(parent, 'iframe-parent-mobile'); checks.push('iframe-autoheight-source-and-origin');
  await parent.screenshot({ path: join(output, 'iframe-mobile.png'), fullPage: true }); await parent.close();
  assert.deepEqual(errors, [], 'Browser console/page errors');
  console.log(JSON.stringify({ checks: checks.length, details: checks, interceptedBookingWrites: writes.length, errors }));
} finally {
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ checks, interceptedBookingWrites: writes.length, errors }, null, 2));
  await browser.close();
}
