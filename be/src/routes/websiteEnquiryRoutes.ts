import express, { type ErrorRequestHandler, type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import HttpError from '../errors/HttpError.js';
import { WEBSITE_ENQUIRY_CONFIG_KEYS } from '../config/websiteEnquiryConfig.js';
import { getConfigValue, refreshConfigCacheKeys } from '../services/configService.js';
import { assertOutboundEmailAllowed } from '../config/outboundEmailPolicy.js';
import { sendMessage } from '../services/bookings/gmailClient.js';
import { createWebsiteEnquiryService, type EnquiryDeliveryResult } from '../services/websiteEnquiryService.js';
import { websiteEnquiryRepository } from '../services/websiteEnquiryRepository.js';

const productionSubmit = createWebsiteEnquiryService({repository: websiteEnquiryRepository, getConfig: getConfigValue, assertOutboundAllowed: assertOutboundEmailAllowed, sendMail: sendMessage});
export type WebsiteEnquiryRouteDependencies = {
  getConfig: (key: string) => unknown;
  refreshConfig: (keys: readonly string[]) => Promise<void>;
  submit: (input: unknown) => Promise<EnquiryDeliveryResult>;
  now: () => number;
};
export const createWebsiteEnquiryRouter = (overrides: Partial<WebsiteEnquiryRouteDependencies> = {}): Router => {
  const deps: WebsiteEnquiryRouteDependencies = {getConfig: getConfigValue, refreshConfig: refreshConfigCacheKeys, submit: productionSubmit, now: Date.now, ...overrides};
  const router = Router();
  const limiter = rateLimit({windowMs: 60_000, max: () => {
    const value = Number(deps.getConfig('STAGING_WEBSITE_ENQUIRY_RATE_LIMIT') ?? 60);
    return Number.isInteger(value) && value >= 1 && value <= 300 ? value : 60;
  }, standardHeaders: true, legacyHeaders: false});
  const handle = async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await deps.refreshConfig(WEBSITE_ENQUIRY_CONFIG_KEYS);
      if (deps.getConfig('STAGING_WEBSITE_ENQUIRY_ENABLED') !== true) throw new HttpError(503, 'Staging enquiry delivery is disabled.');
      const secret = deps.getConfig('STAGING_WEBSITE_ENQUIRY_SIGNING_SECRET');
      const timestamp = req.headers['x-ktk-enquiry-timestamp'], signature = req.headers['x-ktk-enquiry-signature'];
      if (typeof secret !== 'string' || secret.length < 32 || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(deps.now() / 1000 - Number(timestamp)) > 300 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new HttpError(403, 'Invalid integration authentication.');
      if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'JSON request required.');
      const expected = createHmac('sha256', secret).update(timestamp + '\n').update(req.body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new HttpError(403, 'Invalid integration authentication.');
      let input: unknown;
      try { input = JSON.parse(req.body.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON request.'); }
      const result = await deps.submit(input);
      res.status(200).json(result);
    } catch (error) {
      const known = error instanceof HttpError;
      const details = known && error.details && typeof error.details === 'object' ? error.details : {};
      res.status(known ? error.status : 503).json({status: 'error', message: known ? error.message : 'Enquiry delivery is unavailable.', ...details});
    }
  };
  // Mounted before the global JSON parser: HMAC binds the bounded bytes actually received.
  // Fixed 128KiB body and 5min signature window are protocol bounds, not delivery tuning.
  router.post('/staging', limiter, express.raw({type: 'application/json', limit: '128kb', inflate: false}), (req, res) => { void handle(req, res); });
  router.all('/staging', (_req, res) => { res.setHeader('Allow', 'POST'); res.status(405).json({status: 'error', message: 'POST required.'}); });
  const parserError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error?.type === 'encoding.unsupported' ? 415 : 400;
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({status: 'error', message: status === 413 ? 'Enquiry request is too large.' : 'Invalid enquiry request.'});
  };
  router.use(parserError);
  return router;
};
export default createWebsiteEnquiryRouter();
