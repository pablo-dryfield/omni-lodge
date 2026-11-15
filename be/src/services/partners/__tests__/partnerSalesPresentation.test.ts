import { parseSalesAppearance, parseSalesPageConfig, resolveSalesPresentation, salesAppearanceDefaults, salesLinkUrl, salesProductIds } from '../partnerSalesPresentation';

const base = { defaults: {}, links: [] };
it('preserves the existing main page and hides the singular count by default', () => {
  expect(resolveSalesPresentation(null).appearance).toEqual(salesAppearanceDefaults);
  expect(salesAppearanceDefaults.entryMode).toBe('catalog');
  expect(salesAppearanceDefaults.hideSingleCount).toBe(true);
});
it('gives each saved link a server-generated identity and inherits individual defaults', () => {
  const config = parseSalesPageConfig({ defaults: { title: 'Our tours', showPoweredBy: false }, links: [{ name: 'Food tour form', active: true, overrides: { entryMode: 'product', entryProductId: 48, productIds: [48], showTitle: false } }] }, base, [28, 48]);
  expect(config.links[0].code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const { appearance } = resolveSalesPresentation(config, config.links[0].code);
  expect(appearance).toMatchObject({ title: 'Our tours', showPoweredBy: false, showTitle: false, entryProductId: 48 });
  expect(salesProductIds([28, 48], appearance)).toEqual([48]);
  const updated = parseSalesPageConfig({ ...config, defaults: { title: 'New title' } }, config, [28, 48]);
  expect(updated.links[0].code).toBe(config.links[0].code);
  expect(resolveSalesPresentation(updated, config.links[0].code).appearance.title).toBe('New title');
});
it.each([undefined, null, [], { showTitle: 'false' }, { html: '<script>' }, { entryMode: 'wrong' }, { brandDisplay: 'wrong' }, { productIds: [] }])('rejects invalid settings/configuration %p', raw => {
  if (raw && !Array.isArray(raw) && 'productIds' in raw) expect(() => parseSalesPageConfig({ defaults: raw, links: [] }, base, [28])).toThrow('at least one');
  else expect(() => parseSalesAppearance(raw)).toThrow();
});
it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://user:password@example.com/logo.png', 'http://remote.example/logo.png'])('rejects unsafe logo URL %s', logoUrl => {
  expect(() => parseSalesAppearance({ logoUrl })).toThrow();
});
it('keeps text as data and validates lengths without accepting arbitrary settings', () => {
  expect(parseSalesAppearance({ title: '</script><img onerror=alert(1)>', showBrand: false })).toMatchObject({ showBrand: false });
  expect(() => parseSalesAppearance({ title: 'x'.repeat(161) })).toThrow();
  expect(() => parseSalesAppearance({ productIds: [28, 28] })).toThrow();
  expect(() => parseSalesAppearance({ productIds: ['28'] })).toThrow();
});
it('cannot widen approved products or open an excluded product', () => {
  expect(() => parseSalesPageConfig({ defaults: { productIds: [99] }, links: [] }, base, [28])).toThrow('approved');
  expect(() => parseSalesPageConfig({ defaults: {}, links: [{ name: 'Bad', active: true, overrides: { entryMode: 'product', entryProductId: 28, productIds: [48] } }] }, base, [28, 48])).toThrow('included');
  expect(salesProductIds([28], { ...salesAppearanceDefaults, productIds: [28, 48] })).toEqual([28]);
});
it('fails closed for disabled, unknown, malformed or repeated link parameters', () => {
  const config = parseSalesPageConfig({ ...base, links: [{ name: 'Link', active: false, overrides: {} }] }, base, [28]);
  for (const code of [config.links[0].code, 'x'.repeat(43), 'wrong', [config.links[0].code]]) expect(() => resolveSalesPresentation(config, code)).toThrow();
});
it('rejects duplicate ids and invented ids and bounds the link count', () => {
  const config = parseSalesPageConfig({ ...base, links: [{ name: 'Link', active: true, overrides: {} }] }, base, [28]);
  expect(() => parseSalesPageConfig({ defaults: {}, links: [config.links[0], config.links[0]] }, config, [28])).toThrow('Duplicate');
  expect(() => parseSalesPageConfig({ defaults: {}, links: [{ ...config.links[0], id: 'invented' }] }, config, [28])).toThrow('Reload');
  expect(() => parseSalesPageConfig({ defaults: {}, links: Array(51).fill({}) }, base, [28])).toThrow('50');
});
it('preserves the exact link identity in public and Stripe return URL construction', () => {
  const url = salesLinkUrl('https://omni-lodge.com/', 'public', 'specific');
  expect(url).toBe('https://omni-lodge.com/api/partner-sales/public?link=specific');
  expect(salesLinkUrl('https://omni-lodge.com/', 'public')).not.toContain('?');
});
