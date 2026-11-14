import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { PartnerOffering, PartnerProfile } from '../models/Partner.js';
import { loadStorefrontProducts } from '../controllers/storefrontController.js';
import { loadPartnerConfig } from '../services/partners/partnerConfig.js';
import { createPartnerBooking, parsePartnerSelection, quotePartnerBooking } from '../services/partners/partnerBookingService.js';
import { renderPartnerSalesPage } from '../services/partners/partnerSalesPage.js';
import HttpError from '../errors/HttpError.js';

const router = Router();
const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
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
  const nonce = randomBytes(18).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' ${partner.agreement.allowedOrigins.join(' ')}`);
  res.removeHeader('X-Frame-Options');
  return res.type('html').send(renderPartnerSalesPage(partner.name, partner.publicCode, nonce));
}));
router.get('/:code/catalog', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const products = (await loadStorefrontProducts()).filter(p => partner.agreement.productIds.includes(p.id));
  const offerings = await PartnerOffering.findAll({ where: { partnerId: partner.id, active: true }, attributes: ['code', 'kind', 'name', 'items'] });
  return res.json({ name: partner.name, products, offerings });
}));
router.get('/:code/qr', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const config = await loadPartnerConfig();
  return res.type('png').send(await QRCode.toBuffer(`${config.baseUrl}/api/partner-sales/${partner.publicCode}`, { width: 512, margin: 2 }));
}));
router.post('/:code/quote', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const { partnerCommission: _privateCommission, ...customerQuote } = await quotePartnerBooking(partner, parsePartnerSelection(req.body));
  return res.json(customerQuote);
}));
router.post('/:code/book', route(async (req, res) => {
  const partner = await partnerFor(req.params.code);
  const result = await createPartnerBooking({ partner, actorId: null, role: 'customer', admin: false, scopes: null }, req.body, 'website', true);
  return res.status(201).json({ checkoutUrl: result.checkoutUrl, status: result.status });
}));
export default router;
