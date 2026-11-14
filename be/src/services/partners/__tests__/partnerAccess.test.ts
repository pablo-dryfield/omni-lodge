jest.mock('../../../models/Partner.js', () => ({ PartnerProfile: { findByPk: jest.fn() }, PartnerMember: { findOne: jest.fn() }, PartnerCredential: { findOne: jest.fn() } }));
import { PartnerProfile, PartnerMember, PartnerCredential } from '../../../models/Partner';
import { resolvePartner } from '../partnerAccess';
import { hashToken } from '../partnerPolicy';
import type { AuthenticatedRequest } from '../../../types/AuthenticatedRequest';

const req = (role: string, id = 3) => ({ params: { partnerId: '9' }, headers: {}, authContext: { id, roleSlug: role }, productTypeScope: null } as unknown as AuthenticatedRequest);
beforeEach(() => {
  jest.resetAllMocks();
  (PartnerProfile.findByPk as jest.Mock).mockResolvedValue({ id: 9, status: 'active' });
  (PartnerMember.findOne as jest.Mock).mockResolvedValue(null);
});
it('does not grant company management from a product-scoped owner slug', async () => {
  const request = req('owner'); request.productTypeScope = [3];
  await expect(resolvePartner(request, 'admin')).rejects.toThrow(/access/);
});
it('denies a login without exact partner membership even when it has another privileged role', async () => {
  await expect(resolvePartner(req('assistant-manager'))).rejects.toThrow(/access/);
  expect(PartnerMember.findOne).toHaveBeenCalledWith({ where: { partnerId: 9, userId: 3, active: true } });
});
it('grants management only to a company-wide owner', async () => {
  expect((await resolvePartner(req('owner'), 'admin')).admin).toBe(true);
});
it('blocks suspended companies and removed members on every operation', async () => {
  (PartnerMember.findOne as jest.Mock).mockResolvedValue({ role: 'owner' });
  (PartnerProfile.findByPk as jest.Mock).mockResolvedValue({ id: 9, status: 'suspended' });
  await expect(resolvePartner(req('partner'), 'book')).rejects.toThrow(/suspended/);
});
it.each([['agent', 'integrations'], ['agent', 'team'], ['developer', 'book'], ['developer', 'cancel']])('enforces %s restrictions for %s', async (role, scope) => {
  (PartnerMember.findOne as jest.Mock).mockResolvedValue({ role });
  await expect(resolvePartner(req('partner'), scope)).rejects.toThrow(/role/);
});
it('cannot use an API token to escalate into team or settlement management', async () => {
  const request = req('partner'); request.authContext = undefined;
  request.headers.authorization = `Bearer olp_${'a'.repeat(43)}`;
  const update = jest.fn();
  (PartnerCredential.findOne as jest.Mock).mockResolvedValue({ expiresAt: new Date(Date.now() + 60000), scopes: ['read', 'book'], update });
  await expect(resolvePartner(request, 'team')).rejects.toThrow(/token/);
  expect(PartnerCredential.findOne).toHaveBeenCalledWith({ where: { partnerId: 9, tokenHash: hashToken(`olp_${'a'.repeat(43)}`), revokedAt: null } });
});
it('rejects an expired credential before updating last-used time', async () => {
  const request = req('partner'); request.authContext = undefined;
  request.headers.authorization = `Bearer olp_${'b'.repeat(43)}`;
  const update = jest.fn();
  (PartnerCredential.findOne as jest.Mock).mockResolvedValue({ expiresAt: new Date(0), scopes: ['read'], update });
  await expect(resolvePartner(request)).rejects.toThrow(/expired/);
  expect(update).not.toHaveBeenCalled();
});
