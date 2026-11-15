import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { PartnerOffering, PartnerProfile } from '../models/Partner.js';
import { loadStorefrontProducts } from '../controllers/storefrontController.js';
import { loadPartnerConfig } from '../services/partners/partnerConfig.js';
import { createPartnerBooking, parsePartnerSelection, quotePartnerBooking } from '../services/partners/partnerBookingService.js';
import { renderPartnerSalesPage } from '../services/partners/partnerSalesPage.js';
import { partnerSalesEmbedClient } from '../services/partners/partnerSalesClient.js';
import { partnerCalendar } from '../services/partners/partnerSalesAvailability.js';
import { isStorefrontStripeTestMode } from '../finance/services/stripeClient.js';
import HttpError from '../errors/HttpError.js';
import { localPartnerLogoDirectory } from '../services/storefrontMediaService.js';
import { resolveSalesPresentation, salesProductIds, salesLinkUrl } from '../services/partners/partnerSalesPresentation.js';

const router = Router();
const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
router.get('/local-logos/:name', (req, res, next) => {
  if (process.env.NODE_ENV === 'production' || !/^\d+-[a-f0-9-]{36}\.webp$/.test(req.params.name)) return next(new HttpError(404, 'Logo not found.'));
  res.type('webp').sendFile(req.params.name, { root: localPartnerLogoDirectory, maxAge: '1d' }, error => { if (error) next(error); });
});
// Pinned libphonenumber-js 1.13.14 min browser distribution and its MIT license
// live with the UI source assets. This is the same phone parser as storefronts.
router.get('/phone.js', (_req, res, next) => {
  const tree = process.env.NODE_ENV === 'production' ? 'build' : 'public';
  const filename = fileURLToPath(new URL(`../../../ui/${tree}/assets/partner-booking/vendor/libphonenumber-min.js`, import.meta.url));
  res.type('application/javascript').sendFile(filename, { maxAge: '1d' }, error => { if (error) next(error); });
});
// Shared static assets contain no partner data. Ship with the existing UI asset
// tree, and serve from this origin so embedded pages need no third-party fonts.
router.get('/fonts/:name', (req, res, next) => {
  if (!/^(montserrat|oswald|manrope|fraunces)-latin(?:-ext)?\.woff2$/.test(req.params.name)) return next(new HttpError(404, 'Font not found.'));
  const tree = process.env.NODE_ENV === 'production' ? 'build' : 'public';
  const filename = fileURLToPath(new URL(`../../../ui/${tree}/assets/partner-booking/fonts/${req.params.name}`, import.meta.url));
  res.type('font/woff2').sendFile(filename, { maxAge: '1d' }, error => { if (error) next(error); });
});
router.get('/embed.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(partnerSalesEmbedClient));
router.use(rateLimit({ windowMs: 60000, max: async () => (await loadPartnerConfig(false)).publicRpm, standardHeaders: true, legacyHeaders: false }));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); loadPartnerConfig().then(() => next(), next); });
async function partnerFor(code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new HttpError(404, 'Partner booking page not found.');
  const partner = await PartnerProfile.findOne({ where: { publicCode: code, status: 'active' } });
  if (!partner) throw new HttpError(404, 'Partner booking page not found.');
  return partner;
}
router.get('/:code', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const presentation = resolveSalesPresentation(partner.salesPageConfig, req.query.link);
  const nonce = randomBytes(18).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' ${partner.agreement.allowedOrigins.join(' ')}`);
  res.removeHeader('X-Frame-Options');
  return res.type('html').send(renderPartnerSalesPage(partner.name, partner.publicCode, nonce, presentation.appearance, presentation.link?.code));
}));
router.get('/:code/catalog', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const { appearance } = resolveSalesPresentation(partner.salesPageConfig, req.query.link);
  const ids = salesProductIds(partner.agreement.productIds, appearance);
  const products = (await loadStorefrontProducts()).filter(p => ids.includes(p.id));
  const offerings = await PartnerOffering.findAll({ where: { partnerId: partner.id, active: true }, attributes: ['code', 'kind', 'name', 'items'] });
  return res.json({ name: partner.name, appearance, products, offerings: offerings.filter(o => o.items.every(item => ids.includes(item.productId))), checkoutMode: isStorefrontStripeTestMode() ? 'test' : 'live' });
}));
router.get('/:code/availability', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const { appearance } = resolveSalesPresentation(partner.salesPageConfig, req.query.link);
  const ids = salesProductIds(partner.agreement.productIds, appearance);
  const productId = Number(req.query.productId);
  if (!Number.isSafeInteger(productId) || !ids.includes(productId)) throw new HttpError(404, 'Experience not available through this booking link.');
  const product = (await loadStorefrontProducts()).find(value => value.id === productId);
  if (!product) throw new HttpError(404, 'Experience not available through this partner.');
  return res.json(partnerCalendar(product.config, req.query.month, req.query.time, ids));
}));
router.get('/:code/qr', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const { link } = resolveSalesPresentation(partner.salesPageConfig, req.query.link);
  const config = await loadPartnerConfig();
  return res.type('png').send(await QRCode.toBuffer(salesLinkUrl(config.baseUrl, partner.publicCode, link?.code), { width: 512, margin: 2 }));
}));
router.post('/:code/quote', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const { appearance } = resolveSalesPresentation(partner.salesPageConfig, req.query.link);
  const input = parsePartnerSelection(req.body);
  const ids = salesProductIds(partner.agreement.productIds, appearance);
  if (input.items.some(item => !ids.includes(Number(item.productId)))) throw new HttpError(403, 'An experience is not available through this booking link.');
  const { partnerCommission: _privateCommission, ...customerQuote } = await quotePartnerBooking(partner, input);
  return res.json(customerQuote);
}));
router.post('/:code/book', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const { link } = resolveSalesPresentation(partner.salesPageConfig, req.query.link);
  const result = await createPartnerBooking({ partner, actorId: null, role: 'customer', admin: false, scopes: null }, req.body, 'website', true, link?.code);
  return res.status(201).json({ checkoutUrl: result.checkoutUrl, status: result.status });
}));
export default router;
