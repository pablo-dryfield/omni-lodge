// Local visual geometry regression. No booking/payment/email writes are allowed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

assert.equal(process.env.PARTNER_SALES_BROWSER_TEST, 'true');
const url = new URL(process.env.PARTNER_SALES_PREVIEW_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const require = createRequire(new URL('../package.json', import.meta.url));
const browser = await require('puppeteer').launch({ headless: true });
const output = join(process.env.USERPROFILE, '.omnilodge-local', 'partner-storefront-design');
await mkdir(output, { recursive: true });
const results = [], errors = [];
try {
  for (const width of [1440, 1000, 768, 390, 320]) {
    for (const product of ['Pub Crawl', 'Food Tour Krakow']) {
      const page = await browser.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width, height: 1000 });
      await page.setRequestInterception(true);
      page.on('request', request => void (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? request.continue() : request.abort()));
      await page.goto(url.href, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.activity-card');
      await page.click(`button[aria-label="Book ${product}"]`);
      await page.evaluate(() => document.fonts.ready);
      if (product === 'Pub Crawl') {
        await page.select('select[data-gender="men"]', '3');
        const shirtSelect = await page.$('.ktk-configurator__addon:has(.ktk-configurator__addon-title strong) select[aria-label*="Shirts quantity"]');
        if (shirtSelect) await shirtSelect.select('2');
      }
      for (const state of ['empty', 'selected', 'long-name']) {
        if (state !== 'empty') {
          await page.select('select[name="phoneCountry"]', state === 'long-name' ? 'GB' : 'PL');
          await page.$eval('input[name="fullName"]', element => { element.value = 'Alex Preview'; element.dispatchEvent(new Event('input', { bubbles: true })); });
        }
        const geometry = await page.evaluate(() => {
          const observations = [];
          const checkText = (label, element, container) => {
            if (!element || !container || !element.getClientRects().length) return;
            const range = document.createRange(); range.selectNodeContents(element);
            const fullText = range.getBoundingClientRect(), box = container.getBoundingClientRect();
            const text = getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth ? element.getBoundingClientRect() : fullText;
            if (!text.width || text.width > box.width - 2) return;
            observations.push({ label, axis: 'horizontal', offset: +((text.left + text.width / 2) - (box.left + box.width / 2)).toFixed(2) });
            if (container.tagName === 'BUTTON') observations.push({ label, axis: 'vertical', offset: +((text.top + text.height / 2) - (box.top + box.height / 2)).toFixed(2) });
          };
          document.querySelectorAll('.ktk-custom-select__trigger>span,.ktk-date-picker__trigger>.date-text,.date-trigger>.date-text,.country-trigger>span').forEach(element => checkText(element.parentElement.getAttribute('aria-label'), element, element.parentElement));
          document.querySelectorAll('.field>span').forEach(element => checkText(element.textContent, element, element.parentElement));
          document.querySelectorAll('.back-link').forEach(element => {
            const label = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            const range = document.createRange(); range.selectNodeContents(label);
            const text = range.getBoundingClientRect(), row = element.parentElement.getBoundingClientRect(), arrow = element.querySelector('svg').getBoundingClientRect();
            const groupLeft = Math.min(text.left, arrow.left), groupRight = Math.max(text.right, arrow.right);
            observations.push({ label: 'All experiences and arrow group', axis: 'horizontal', offset: +((groupLeft + groupRight) / 2 - (row.left + row.width / 2)).toFixed(2) });
            observations.push({ label: 'Back arrow on left', axis: 'arrow-position', offset: arrow.right <= text.left ? 0 : 100 });
          });
          document.querySelectorAll('.ktk-practical-info__section>a').forEach(element => checkText('Open in Google Maps', element, element.parentElement.parentElement.childElementCount === 1 ? element.parentElement.parentElement : element.parentElement));
          const total = document.querySelector('.ktk-configurator__total');
          if (total) {
            const label = total.querySelector('span').getBoundingClientRect(), amount = total.querySelector('strong').getBoundingClientRect();
            observations.push({ label: 'Estimated total and amount', axis: 'vertical', offset: +((label.top + label.height / 2) - (amount.top + amount.height / 2)).toFixed(2) });
          }
          document.querySelectorAll('.ktk-booking__cta,.food-payment-button,.notes-toggle').forEach(element => {
            const label = element.querySelector('.button-label') || [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (label) {
              const range = document.createRange(); range.selectNodeContents(label);
              const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
              observations.push({ label: element.textContent.trim(), axis: 'horizontal', offset: +((text.left + text.width / 2) - (box.left + box.width / 2)).toFixed(2) });
            }
          });
          document.querySelectorAll('input[name="fullName"],input[name="email"],input[name="phone"],.quantity-stepper input').forEach(element => {
            const css = getComputedStyle(element);
            observations.push({ label: element.name || element.getAttribute('aria-label'), axis: 'input-padding', offset: +(parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)).toFixed(2), textAlign: css.textAlign });
          });
          return observations;
        });
        results.push({ width, product, state, observations: geometry, failures: geometry.filter(item => Math.abs(item.offset) > 1.5 || item.textAlign && item.textAlign !== 'center') });
      }
      if ([1440, 390].includes(width)) await page.screenshot({ path: join(output, `${product === 'Pub Crawl' ? 'ktk' : 'food'}-alignment-${width}.png`), fullPage: true });
      await page.close();
    }
  }
  const failures = results.flatMap(result => result.failures.map(item => ({ width: result.width, product: result.product, state: result.state, ...item })));
  console.log(JSON.stringify({ states: results.length, assertions: results.reduce((sum, result) => sum + result.observations.length, 0), errors, failures }));
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
} finally {
  await writeFile(join(output, process.env.PARTNER_ALIGNMENT_REPORT || 'alignment-results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
