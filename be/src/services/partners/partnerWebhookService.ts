import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import { PartnerDelivery, PartnerEvent, PartnerWebhook } from '../../models/Partner.js';
import { decryptSecret } from '../configEncryptionService.js';
import { loadPartnerConfig } from './partnerConfig.js';

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]] as const) blocked.addSubnet(ip, prefix, 'ipv6');
export const publicNetworkAddress = (address: string): boolean => isIP(address) === 4 ? !blocked.check(address, 'ipv4')
  : isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
export function webhookUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Enter a valid HTTPS webhook URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !url.hostname.includes('.')) throw new HttpError(400, 'Webhooks require an HTTPS public hostname on port 443 without credentials.');
  return url;
}
export const webhookSignature = (secret: string, timestamp: string, payload: string): string => createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

async function deliver(urlString: string, secret: string, event: PartnerEvent): Promise<number> {
  const url = webhookUrl(urlString);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicNetworkAddress(item.address))) throw new Error('Webhook destination is not public.');
  const selected = addresses[0];
  const body = JSON.stringify({ id: `partner-event-${event.id}`, type: event.type, createdAt: event.createdAt, bookingId: event.bookingId, data: event.data });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST', timeout: 8000, family: selected.family,
      // Pin the already-validated address; DNS cannot be rebound between validation and connect.
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'OmniLodge-Partners/1', 'X-OmniLodge-Event': `partner-event-${event.id}`, 'X-OmniLodge-Signature': `t=${timestamp},v1=${webhookSignature(secret, timestamp, body)}` },
    }, response => { clearTimeout(deadline); response.destroy(); resolve(response.statusCode || 0); });
    const deadline = setTimeout(() => req.destroy(new Error('Webhook deadline exceeded.')), 8000);
    req.on('error', error => { clearTimeout(deadline); reject(error); });
    req.on('timeout', () => req.destroy(new Error('Webhook timed out.')));
    req.end(body);
  });
}

export async function deliverPartnerEvents(): Promise<void> {
  if (process.env.DISABLE_BACKGROUND_JOBS === 'true') return;
  const config = await loadPartnerConfig(false);
  const due = await PartnerDelivery.findAll({ where: { status: { [Op.in]: ['pending', 'retry'] }, [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: new Date() } }] }, order: [['id', 'ASC']], limit: 20 });
  for (const candidate of due) {
    await sequelize.transaction(async transaction => {
      const row = await PartnerDelivery.findByPk(candidate.id, { transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
      if (!row || !['pending', 'retry'].includes(row.status) || (row.nextAttemptAt && row.nextAttemptAt > new Date())) return;
      const endpoint = await PartnerWebhook.findOne({ where: { partnerId: row.partnerId, active: true }, transaction });
      const event = await PartnerEvent.findByPk(row.eventId, { transaction });
      if (!endpoint || !event) { await row.update({ status: 'disabled' }, { transaction }); return; }
      let status = 0;
      try { status = await deliver(endpoint.url, decryptSecret(endpoint.secret), event); } catch { /* A safe status is recorded; never persist response bodies or credentials. */ }
      const attempts = row.attempts + 1;
      await row.update({ attempts, lastStatus: status || null, status: status >= 200 && status < 300 ? 'delivered' : attempts >= config.webhookAttempts ? 'failed' : 'retry', nextAttemptAt: new Date(Date.now() + Math.min(86400, 30 * 2 ** attempts) * 1000) }, { transaction });
    });
  }
}
