import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import { PartnerCredential, PartnerMember, PartnerProfile } from '../../models/Partner.js';
import HttpError from '../../errors/HttpError.js';
import { hashToken, positiveId } from './partnerPolicy.js';

export type PartnerContext = { partner: PartnerProfile; actorId: number | null; role: string; admin: boolean; scopes: string[] | null };
export const partnerAdministrator = (request: AuthenticatedRequest): boolean => request.productTypeScope == null
  && ['admin', 'administrator', 'owner', 'manager'].includes(request.authContext?.roleSlug || '');
export async function resolvePartner(request: AuthenticatedRequest, scope = 'read'): Promise<PartnerContext> {
  const partner = await PartnerProfile.findByPk(positiveId(request.params.partnerId));
  if (!partner) throw new HttpError(404, 'Partner not found.');
  const admin = partnerAdministrator(request);
  const actorId = request.authContext?.id ?? null;
  let role = 'administrator';
  let scopes: string[] | null = null;
  if (!admin) {
    const bearer = request.headers.authorization?.match(/^Bearer (olp_[A-Za-z0-9_-]{43})$/)?.[1];
    if (bearer) {
      const credential = await PartnerCredential.findOne({ where: { partnerId: partner.id, tokenHash: hashToken(bearer), revokedAt: null } });
      if (!credential || credential.expiresAt <= new Date()) throw new HttpError(401, 'Partner API token is invalid or expired.');
      scopes = credential.scopes;
      role = 'api';
      await credential.update({ lastUsedAt: new Date() });
    } else {
      if (!actorId) throw new HttpError(401, 'Sign in to access the partner portal.');
      const member = await PartnerMember.findOne({ where: { partnerId: partner.id, userId: actorId, active: true } });
      if (!member) throw new HttpError(403, 'You do not have access to this partner.');
      role = member.role;
    }
  }
  if (!admin && partner.status !== 'active') throw new HttpError(403, 'This partner account is suspended.');
  if (scopes && !scopes.includes(scope)) throw new HttpError(403, `This API token does not permit ${scope}.`);
  if (!admin && !scopes && ((['team', 'settings', 'settle'].includes(scope) && role !== 'owner') || (scope === 'integrations' && role === 'agent') || (['book', 'amend', 'cancel', 'refund'].includes(scope) && role === 'developer'))) throw new HttpError(403, 'Your partner role cannot perform this action.');
  if (scope === 'admin' && !admin) throw new HttpError(403, 'Company-wide management access is required.');
  return { partner, actorId, role, admin, scopes };
}
export const isPartnerToken = (request: Request): boolean => /^Bearer olp_/.test(request.headers.authorization || '');
