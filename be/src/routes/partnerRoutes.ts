import { Router, type NextFunction, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Op, QueryTypes, type WhereOptions } from 'sequelize';
import authMiddleware from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import sequelize from '../config/database.js';
import Channel from '../models/Channel.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import { PartnerBooking, PartnerCredential, PartnerDelivery, PartnerEvent, PartnerMember, PartnerOffering, PartnerProfile, PartnerWebhook, PartnerAmendment } from '../models/Partner.js';
import HttpError from '../errors/HttpError.js';
import { loadStorefrontProducts } from '../controllers/storefrontController.js';
import { encryptSecret } from '../services/configEncryptionService.js';
import { assertProducts, defaultAgreement, hashToken, money, opaqueToken, parseAgreement, positiveId } from '../services/partners/partnerPolicy.js';
import { isPartnerToken, partnerAdministrator, resolvePartner } from '../services/partners/partnerAccess.js';
import { loadPartnerConfig } from '../services/partners/partnerConfig.js';
import { approvePartnerRequest, createPartnerBooking, parsePartnerSelection, partnerBookingDetails, quotePartnerBooking } from '../services/partners/partnerBookingService.js';
import { changePartnerBooking } from '../services/partners/partnerActions.js';
import { partnerEvent } from '../services/partners/partnerEvents.js';
import { onboardPartnerConnect, partnerConnectStatus, partnerStatement, reconcilePartnerOrder } from '../services/partners/partnerStripeService.js';
import { webhookUrl } from '../services/partners/partnerWebhookService.js';
import { parsePartnerCsv } from '../services/partners/partnerCsvImport.js';
import { cancelPartnerAmendment, quotePartnerAmendment, completePartnerAmendment } from '../services/partners/partnerAmendmentService.js';
import { refundPartnerBooking, recordExternalPartnerRefund } from '../services/partners/partnerRefundService.js';

const router = Router();
type Handler = (request: AuthenticatedRequest, response: Response) => Promise<unknown>;
const pageInteger = (value: unknown, fallback: number, max: number) => { const parsed = value == null ? fallback : Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new HttpError(400, 'Invalid pagination value.'); return parsed; };
const route = (handler: Handler) => (request: AuthenticatedRequest, response: Response, next: NextFunction) => { Promise.resolve(handler(request, response)).catch(next); };
router.use(rateLimit({ windowMs: 60000, max: async () => (await loadPartnerConfig(false)).apiRpm, standardHeaders: true, legacyHeaders: false }));
router.use((request: AuthenticatedRequest, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  if (isPartnerToken(request)) { next(); return; }
  authMiddleware(request, response, next);
});
router.use((_req, _res, next) => { loadPartnerConfig(false).then(() => next(), next); });

router.get('/', route(async (req, res) => {
  const admin = partnerAdministrator(req);
  const memberships = admin ? [] : await PartnerMember.findAll({ where: { userId: req.authContext?.id || 0, active: true } });
  const partners = await PartnerProfile.findAll({ where: admin ? {} : { id: { [Op.in]: memberships.map(m => m.partnerId) }, status: 'active' }, order: [['name', 'ASC']] });
  const channels = admin ? await Channel.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }) : [];
  const products = admin ? await Product.findAll({ where: { status: true }, attributes: ['id', 'name'], order: [['name', 'ASC']] }) : [];
  return res.json({ admin, partners: partners.map(p => ({ id: p.id, channelId: p.channelId, name: p.name, status: p.status, role: admin ? 'administrator' : memberships.find(m => m.partnerId === p.id)?.role })), channels, products, defaultAgreement });
}));

router.post('/', route(async (req, res) => {
  if (!partnerAdministrator(req)) throw new HttpError(403, 'Only company-wide managers can enable a Channel as a partner.');
  const channel = await Channel.findByPk(positiveId(req.body.channelId));
  if (!channel) throw new HttpError(404, 'Channel not found.');
  if (await PartnerProfile.findOne({ where: { channelId: channel.id } })) throw new HttpError(409, 'This Channel is already enabled as a partner. Select it in the company picker.');
  const agreement = parseAgreement(req.body.agreement);
  if (await Product.count({ where: { id: { [Op.in]: agreement.productIds }, status: true } }) !== agreement.productIds.length) throw new HttpError(400, 'Select active products.');
  const partner = await sequelize.transaction(async transaction => {
    const row = await PartnerProfile.create({ channelId: channel.id, publicCode: opaqueToken(), name: channel.name, agreement, createdBy: req.authContext!.id, version: 1 }, { transaction });
    await partnerEvent(row.id, 'partner.created', { channelId: row.channelId, agreement }, req.authContext!.id, null, transaction);
    return row;
  });
  return res.status(201).json({ id: partner.id });
}));

router.get('/:partnerId/overview', route(async (req, res) => {
  const ctx = await resolvePartner(req);
  const catalog = (await loadStorefrontProducts()).filter(p => ctx.partner.agreement.productIds.includes(p.id));
  const members = ctx.admin || ctx.role === 'owner' ? await PartnerMember.findAll({ where: { partnerId: ctx.partner.id }, order: [['id', 'ASC']] }) : [];
  const users = members.length ? await User.findAll({ where: { id: { [Op.in]: members.map(m => m.userId) } }, attributes: ['id', 'firstName', 'lastName', 'username'] }) : [];
  const offerings = await PartnerOffering.findAll({ where: { partnerId: ctx.partner.id }, order: [['id', 'ASC']] });
  const config = await loadPartnerConfig(false);
  const [metrics] = await sequelize.query<{ confirmed: number; requests: number; awaitingPayment: number; confirmedValue: string }>(`SELECT count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed, count(*) FILTER (WHERE status = 'requested')::int AS requests, count(*) FILTER (WHERE status = 'pending_payment')::int AS "awaitingPayment", COALESCE(sum(total - refunded_amount) FILTER (WHERE status = 'confirmed'), 0)::text AS "confirmedValue" FROM partner_bookings WHERE partner_id = :partnerId`, { replacements: { partnerId: ctx.partner.id }, type: QueryTypes.SELECT });
  return res.json({ partner: { id: ctx.partner.id, name: ctx.partner.name, channelId: ctx.partner.channelId, status: ctx.partner.status, version: ctx.partner.version, agreement: ctx.partner.agreement }, role: ctx.role, admin: ctx.admin, catalog, offerings, metrics, members: members.map(m => ({ id: m.id, userId: m.userId, role: m.role, active: m.active, user: users.find(u => u.id === m.userId) })), salesUrl: `${config.baseUrl}/api/partner-sales/${ctx.partner.publicCode}`, connectEnabled: config.connectEnabled, bookingsEnabled: config.enabled });
}));

router.put('/:partnerId/agreement', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'admin');
  const agreement = parseAgreement(req.body.agreement);
  if (!req.body.reason?.trim()) throw new HttpError(400, 'Record the reason for changing the agreement.');
  if (await Product.count({ where: { id: { [Op.in]: agreement.productIds }, status: true } }) !== agreement.productIds.length) throw new HttpError(400, 'Select active products.');
  await sequelize.transaction(async transaction => {
    const partner = (await PartnerProfile.findByPk(ctx.partner.id, { transaction, lock: transaction.LOCK.UPDATE }))!;
    if (partner.version !== Number(req.body.version)) throw new HttpError(409, 'Another manager changed this agreement. Reload it before saving.');
    const status = req.body.status ?? partner.status;
    if (!['active', 'suspended'].includes(status)) throw new HttpError(400, 'Invalid partner status.');
    await partnerEvent(partner.id, 'agreement.updated', { before: partner.agreement, after: agreement, version: partner.version + 1, status, reason: req.body.reason }, ctx.actorId, null, transaction);
    await partner.update({ agreement, status, version: partner.version + 1 }, { transaction });
  });
  return res.json({ saved: true });
}));

router.post('/:partnerId/members', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'team');
  const userId = req.body.userId ? positiveId(req.body.userId) : (await User.findOne({ where: { email: String(req.body.email || '').trim().toLowerCase() }, attributes: ['id'] }))?.id;
  if (!userId) throw new HttpError(400, 'No active user found. Create a Partner login in Settings → Users first.');
  const role = req.body.role;
  if (!['owner', 'agent', 'developer'].includes(role) || typeof req.body.active !== 'boolean') throw new HttpError(400, 'Choose a valid team role and activation state.');
  const user = await User.findByPk(userId);
  if (!user || !user.status) throw new HttpError(400, 'Select an active login user. A staff profile is not required.');
  await sequelize.transaction(async transaction => {
    await PartnerProfile.findByPk(ctx.partner.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!ctx.admin && userId === ctx.actorId && (!req.body.active || role !== 'owner')) throw new HttpError(409, 'A company owner cannot remove their own management access.');
    const [member] = await PartnerMember.findOrCreate({ where: { partnerId: ctx.partner.id, userId }, defaults: { role, active: req.body.active }, transaction });
    await member.update({ role, active: req.body.active }, { transaction });
    await partnerEvent(ctx.partner.id, 'member.updated', { userId, role, active: req.body.active }, ctx.actorId, null, transaction);
  });
  return res.json({ saved: true });
}));

router.get('/:partnerId/bookings', route(async (req, res) => {
  const ctx = await resolvePartner(req);
  const limit = Math.max(1, pageInteger(req.query.limit, 25, 100));
  const offset = pageInteger(req.query.offset, 0, 2147483647);
  const where: WhereOptions = { partnerId: ctx.partner.id };
  if (req.query.status) Object.assign(where, { status: String(req.query.status).slice(0, 32) });
  if (req.query.paymentMode) Object.assign(where, { paymentMode: String(req.query.paymentMode).slice(0, 24) });
  if (req.query.search) Object.assign(where, { externalReference: { [Op.iLike]: `%${String(req.query.search).replace(/[%_\\]/g, '').slice(0, 100)}%` } });
  const { rows, count } = await PartnerBooking.findAndCountAll({ where, limit, offset, order: [['id', 'DESC']] });
  const details = await Promise.all(rows.map(row => partnerBookingDetails(ctx.partner.id, row.id)));
  return res.json({ rows: details, count, limit, offset });
}));
router.get('/:partnerId/bookings/:id', route(async (req, res) => { const ctx = await resolvePartner(req); return res.json(await partnerBookingDetails(ctx.partner.id, positiveId(req.params.id))); }));
router.post('/:partnerId/quote', route(async (req, res) => { const ctx = await resolvePartner(req, 'book'); return res.json(await quotePartnerBooking(ctx.partner, parsePartnerSelection(req.body))); }));
router.post('/:partnerId/bookings', route(async (req, res) => { const ctx = await resolvePartner(req, 'book'); return res.status(201).json(await createPartnerBooking(ctx, req.body, ctx.scopes ? 'api' : 'portal')); }));
router.post('/:partnerId/bookings/:id/decision', route(async (req, res) => { const ctx = await resolvePartner(req, 'admin'); return res.json(await approvePartnerRequest(ctx, positiveId(req.params.id), req.body.approve === true, String(req.body.reason || ''))); }));
for (const action of ['cancel', 'amend'] as const) router.post(`/:partnerId/bookings/:id/${action}`, route(async (req, res) => { const ctx = await resolvePartner(req, action); return res.json(await changePartnerBooking(ctx, positiveId(req.params.id), action, req.body)); }));
router.post('/:partnerId/bookings/:id/amend/quote', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'amend');
  return res.json(await quotePartnerAmendment(ctx, positiveId(req.params.id), req.body));
}));
router.post('/:partnerId/bookings/:id/amendments/:amendmentId/cancel', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'amend');
  return res.json(await cancelPartnerAmendment(ctx, positiveId(req.params.id), positiveId(req.params.amendmentId)));
}));
router.post('/:partnerId/bookings/:id/refund', route(async (req, res) => { const ctx = await resolvePartner(req, 'refund'); return res.json(await refundPartnerBooking(ctx, positiveId(req.params.id), req.body)); }));

router.post('/:partnerId/import', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'book');
  const config = await loadPartnerConfig();
  const rows: unknown[] = req.body.csv != null ? parsePartnerCsv(req.body.csv, config.bulkMax) : req.body.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > config.bulkMax) throw new HttpError(400, `Provide 1–${config.bulkMax} booking rows.`);
  const results = [];
  for (let index = 0; index < rows.length; index++) {
    try {
      const input = parsePartnerSelection(rows[index]);
      const result = req.body.commit === true ? await createPartnerBooking(ctx, input, 'import') : await quotePartnerBooking(ctx.partner, input);
      results.push({ row: index + 1, success: true, result });
    } catch (error) { results.push({ row: index + 1, success: false, error: error instanceof HttpError ? error.message : 'Unable to process this row. No successful result has been recorded for it.' }); }
  }
  return res.json({ committed: req.body.commit === true, results });
}));

router.post('/:partnerId/offerings', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'settings');
  const { code, name, kind, items } = req.body;
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(code) || typeof name !== 'string' || !name.trim() || name.length > 160 || !['package', 'voucher'].includes(kind) || !Array.isArray(items) || !items.length || items.length > 20) throw new HttpError(400, 'Provide a code, name and approved experience list.');
  assertProducts(ctx.partner.agreement, items);
  const normalized = items.map(item => ({ productId: positiveId(item.productId), quantity: positiveId(item.quantity), ...(item.experienceTime ? { experienceTime: String(item.experienceTime).slice(0, 5) } : {}) }));
  const [offering] = await PartnerOffering.findOrCreate({ where: { partnerId: ctx.partner.id, code }, defaults: { kind, name: name.trim(), items: normalized } });
  await offering.update({ kind, name: name.trim(), items: normalized, active: req.body.active !== false });
  await partnerEvent(ctx.partner.id, 'offering.updated', { id: offering.id, code, kind, active: offering.active }, ctx.actorId, null);
  return res.json(offering);
}));

router.get('/:partnerId/statements', route(async (req, res) => {
  const ctx = await resolvePartner(req);
  const offset = pageInteger(req.query.offset, 0, 2147483647);
  const { rows, count } = await PartnerBooking.findAndCountAll({ where: { partnerId: ctx.partner.id }, order: [['id', 'DESC']], offset, limit: 100 });
  return res.json({ rows: rows.map(partnerStatement), count, offset, limit: 100 });
}));
router.post('/:partnerId/bookings/:id/settlement', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'admin');
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount !== money(amount) || !req.body.reference?.trim() || !req.body.reason?.trim()) throw new HttpError(400, 'A positive amount, payment reference and reason are required.');
  await sequelize.transaction(async transaction => {
    const row = await PartnerBooking.findOne({ where: { id: positiveId(req.params.id), partnerId: ctx.partner.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row || !['confirmed', 'cancelled', 'refunded'].includes(row.status)) throw new HttpError(409, 'A confirmed booking is required.');
    const statement = partnerStatement(row);
    if (!statement.manualSettlementAllowed) throw new HttpError(409, 'This booking does not use manual partner settlement.');
    const due = row.paymentMode === 'partner' ? statement.partnerOwes : statement.commissionOutstanding;
    if (amount > due) throw new HttpError(409, 'The amount exceeds the outstanding settlement.');
    const previous = await PartnerEvent.findOne({ where: { partnerId: ctx.partner.id, bookingId: row.id, type: 'settlement.recorded', data: { reference: String(req.body.reference) } }, transaction });
    if (previous) throw new HttpError(409, 'This settlement reference has already been recorded.');
    await row.update({ settledAmount: money(Number(row.settledAmount) + amount) }, { transaction });
    await partnerEvent(ctx.partner.id, 'settlement.recorded', { reference: req.body.reference, reason: req.body.reason, amount, direction: row.paymentMode === 'partner' ? 'partner_to_platform' : 'platform_to_partner' }, ctx.actorId, row.id, transaction);
  });
  return res.json({ recorded: true, message: 'Settlement recorded. This action does not move bank funds.' });
}));

router.post('/:partnerId/bookings/:id/settlement-return', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'admin');
  const amount = Number(req.body.amount);
  const reference = typeof req.body.reference === 'string' ? req.body.reference.trim() : '';
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isFinite(amount) || amount <= 0 || money(amount) !== amount || !reference || reference.length > 160 || !reason || reason.length > 1000) throw new HttpError(400, 'A returned amount, receipt reference and reason are required.');
  await sequelize.transaction(async transaction => {
    const row = await PartnerBooking.findOne({ where: { id: positiveId(req.params.id), partnerId: ctx.partner.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row || Number(row.settledAmount) <= 0) throw new HttpError(409, 'Only previously recorded manual settlements use this receipt action.');
    const previous = await PartnerEvent.findOne({ where: { partnerId: ctx.partner.id, bookingId: row.id, type: 'settlement.returned', data: { reference } }, transaction });
    if (previous) { if (Number(previous.data.amount) !== amount) throw new HttpError(409, 'This receipt was used for another amount.'); return; }
    const statement = partnerStatement(row);
    if (amount > Math.max(statement.partnerCredit, statement.commissionOverpaid) || amount > Number(row.settledAmount)) throw new HttpError(409, 'The amount exceeds the settlement credit or overpayment.');
    await row.update({ settledAmount: money(Number(row.settledAmount) - amount) }, { transaction });
    await partnerEvent(ctx.partner.id, 'settlement.returned', { reference, reason, amount, direction: row.paymentMode === 'partner' ? 'platform_to_partner' : 'partner_to_platform' }, ctx.actorId, row.id, transaction);
  });
  return res.json({ recorded: true, message: 'Completed settlement return recorded. No bank funds were moved.' });
}));

router.post('/:partnerId/bookings/:id/record-partner-refund', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'admin');
  return res.json(await recordExternalPartnerRefund(ctx, positiveId(req.params.id), req.body));
}));

router.get('/:partnerId/integrations', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'integrations');
  const credentials = await PartnerCredential.findAll({ where: { partnerId: ctx.partner.id }, attributes: ['id', 'label', 'scopes', 'expiresAt', 'revokedAt', 'lastUsedAt'], order: [['id', 'DESC']] });
  const webhook = await PartnerWebhook.findOne({ where: { partnerId: ctx.partner.id }, attributes: ['id', 'url', 'active'] });
  const deliveries = await PartnerDelivery.findAll({ where: { partnerId: ctx.partner.id }, order: [['id', 'DESC']], limit: 50 });
  return res.json({ credentials, webhook, deliveries, apiBase: `/api/partners/${ctx.partner.id}`, sandbox: process.env.NODE_ENV !== 'production' });
}));
router.post('/:partnerId/credentials', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'settings');
  const config = await loadPartnerConfig();
  const scopes = req.body.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(s => !['read', 'book', 'cancel', 'amend', 'refund'].includes(s)) || typeof req.body.label !== 'string' || !req.body.label.trim() || req.body.label.length > 100) throw new HttpError(400, 'Provide a label and supported API scopes.');
  const token = `olp_${opaqueToken()}`;
  const row = await PartnerCredential.create({ partnerId: ctx.partner.id, label: req.body.label, scopes, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + config.tokenDays * 86400000) });
  await partnerEvent(ctx.partner.id, 'credential.created', { id: row.id, label: row.label, scopes }, ctx.actorId, null);
  return res.status(201).json({ id: row.id, token, expiresAt: row.expiresAt });
}));
router.delete('/:partnerId/credentials/:id', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'settings');
  await PartnerCredential.update({ revokedAt: new Date() }, { where: { id: positiveId(req.params.id), partnerId: ctx.partner.id } });
  await partnerEvent(ctx.partner.id, 'credential.revoked', { id: req.params.id }, ctx.actorId, null);
  return res.json({ revoked: true });
}));
router.put('/:partnerId/webhook', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'integrations');
  const url = webhookUrl(String(req.body.url)).toString();
  const secret = opaqueToken();
  const [row] = await PartnerWebhook.findOrCreate({ where: { partnerId: ctx.partner.id }, defaults: { url, secret: encryptSecret(secret), active: true } });
  await row.update({ url, secret: encryptSecret(secret), active: req.body.active !== false });
  await partnerEvent(ctx.partner.id, 'webhook.updated', { url, active: row.active }, ctx.actorId, null);
  return res.json({ saved: true, secret });
}));
router.post('/:partnerId/deliveries/:id/replay', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'integrations');
  await PartnerDelivery.update({ status: 'pending', attempts: 0, nextAttemptAt: new Date() }, { where: { id: positiveId(req.params.id), partnerId: ctx.partner.id } });
  return res.json({ queued: true });
}));
router.get('/:partnerId/connect', route(async (req, res) => { const ctx = await resolvePartner(req, 'settings'); return res.json(await partnerConnectStatus(ctx.partner)); }));
router.post('/:partnerId/connect/onboard', route(async (req, res) => { const ctx = await resolvePartner(req, 'settings'); return res.json(await onboardPartnerConnect(ctx.partner.id, ctx.actorId)); }));
router.post('/:partnerId/bookings/:id/reconcile', route(async (req, res) => {
  const ctx = await resolvePartner(req, 'settings');
  const row = await PartnerBooking.findOne({ where: { id: positiveId(req.params.id), partnerId: ctx.partner.id } });
  if (!row?.orderId) throw new HttpError(404, 'Order not found.');
  const amendments = await PartnerAmendment.findAll({ where: { bookingId: row.id, status: { [Op.in]: ['pending_payment', 'applying'] } } });
  for (const amendment of amendments) await completePartnerAmendment(amendment.id);
  await reconcilePartnerOrder(row.orderId);
  return res.json(await partnerBookingDetails(ctx.partner.id, row.id));
}));
router.get('/:partnerId/activity', route(async (req, res) => { const ctx = await resolvePartner(req); const offset = pageInteger(req.query.offset, 0, 2147483647); const result = await PartnerEvent.findAndCountAll({ where: { partnerId: ctx.partner.id }, order: [['id', 'DESC']], limit: 25, offset }); return res.json({ rows: result.rows, count: result.count, offset, limit: 25 }); }));

export default router;
