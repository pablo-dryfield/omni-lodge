import Page from '../../models/Page.js';
import UserType from '../../models/UserType.js';
import RolePagePermission from '../../models/RolePagePermission.js';
import { Op, type Transaction } from 'sequelize';

export async function ensurePartnerAccessControl(transaction?: Transaction): Promise<void> {
  const [partnerRole] = await UserType.findOrCreate({ where: { slug: 'partner' }, defaults: { name: 'Partner', description: 'External tour company portal access; company membership is required.', isDefault: false, status: true }, transaction });
  const [page] = await Page.findOrCreate({ where: { slug: 'partners' }, defaults: { name: 'Partners', description: 'Partner company sales, bookings and settlements', sortOrder: 9, status: true }, transaction });
  const roles = await UserType.findAll({ where: { slug: { [Op.in]: ['admin', 'administrator', 'owner', 'manager'] } }, transaction });
  for (const role of [...roles, partnerRole]) await RolePagePermission.findOrCreate({ where: { userTypeId: role.id, pageId: page.id }, defaults: { canView: true, status: true }, transaction });
}
