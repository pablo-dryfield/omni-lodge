// Local-only checks for the complete back-link group, map link and total row.
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
const checks = [], errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => void (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? request.continue() : request.abort()));
  await page.goto(url.href, { waitUntil: 'networkidle2' }); await page.waitForSelector('.activity-card');
  for (const product of ['Pub Crawl', 'Food Tour Krakow']) {
    await page.click(`button[aria-label="Book ${product}"]`);
    if (product === 'Pub Crawl') await page.select('select[data-gender="men"]', '3');
    else await page.click('.food-about>summary');
    for (const width of [1440, 1000, 768, 390, 320]) {
      await page.setViewport({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${product} overflows at ${width}`);
      const observations = await page.evaluate(() => {
        const result = [], centre = rect => rect.left + rect.width / 2;
        const link = document.querySelector('.back-link'), row = link.parentElement.getBoundingClientRect(), arrow = link.querySelector('svg').getBoundingClientRect();
        const label = [...link.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        const range = document.createRange(); range.selectNodeContents(label); const text = range.getBoundingClientRect();
        result.push({ name: 'Arrow and All experiences group', difference: (Math.min(text.left, arrow.left) + Math.max(text.right, arrow.right)) / 2 - centre(row) });
        result.push({ name: 'Arrow is left of text', difference: arrow.right <= text.left ? 0 : 100 });
        document.querySelectorAll('.ktk-practical-info__section>a,.food-experience-content section>a').forEach(element => {
          const section = element.parentElement, owner = section.classList.contains('ktk-practical-info__section') && section.parentElement.childElementCount === 1 ? section.parentElement : section;
          result.push({ name: 'Google Maps link', difference: centre(element.getBoundingClientRect()) - centre(owner.getBoundingClientRect()) });
        });
        const total = document.querySelector('.ktk-configurator__total');
        if (total) { const label = total.querySelector('span').getBoundingClientRect(), amount = total.querySelector('strong').getBoundingClientRect(); result.push({ name: 'Estimated total vertical alignment', difference: label.top + label.height / 2 - amount.top - amount.height / 2 }); }
        const price = document.querySelector('.ktk-detail__starting-price');
        if (price) {
          const amount = price.querySelector('strong').getBoundingClientRect(), caption = price.querySelector('small'), label = caption.getBoundingClientRect();
          const fromRange = document.createRange(); fromRange.selectNodeContents(price.querySelector('span')); const from = fromRange.getBoundingClientRect();
          result.push({ name: 'From is centred above price and per-person group', difference: centre(from) - (amount.left + label.right) / 2 });
          result.push({ name: 'Per-person caption is to the right of the price', difference: label.left >= amount.right + 6 ? 0 : 100 });
          result.push({ name: 'Per-person caption is at the price bottom', difference: label.bottom - amount.bottom });
          result.push({ name: 'Per-person caption text is left aligned', difference: getComputedStyle(caption).textAlign === 'left' ? 0 : 100 });
        }
        return result;
      });
      checks.push(...observations.map(item => ({ product, width, ...item })));
      if ([1440, 390].includes(width)) {
        await (await page.$('.back-link')).screenshot({ path: join(output, `${product === 'Pub Crawl' ? 'ktk' : 'food'}-back-link-${width}.png`) });
        if (product === 'Pub Crawl') {
          await (await page.$('.ktk-practical-info')).screenshot({ path: join(output, `meeting-point-centred-${width}.png`) });
          await (await page.$('.ktk-configurator__total')).screenshot({ path: join(output, `estimated-total-centred-${width}.png`) });
          await (await page.$('.ktk-detail__starting-price')).screenshot({ path: join(output, `price-per-person-${width}.png`) });
        }
      }
    }
    await page.click('.back-link'); await page.waitForSelector('.activity-card');
  }
  assert.deepEqual(errors, []);
  const failures = checks.filter(item => Math.abs(item.difference) > 1.5);
  console.log(JSON.stringify({ assertions: checks.length, failures, errors })); assert.deepEqual(failures, []);
} finally { await writeFile(join(output, 'links-alignment-results.json'), JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
