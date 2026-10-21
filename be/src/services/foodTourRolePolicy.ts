import type { Transaction } from 'sequelize';
import UserType from '../models/UserType.js';
import ProductType from '../models/ProductType.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

export async function isFoodTourOwner(req: AuthenticatedRequest, scope: number[], transaction?: Transaction): Promise<boolean> {
  if (scope.length !== 1 || !req.authContext?.userTypeId) return false;
  const role = await UserType.findByPk(req.authContext.userTypeId, { attributes: ['id', 'slug', 'status'], transaction });
  if (!role?.status || role.slug !== 'food-tour-owner') return false;
  const product = await ProductType.findByPk(scope[0], { attributes: ['id', 'name'], transaction });
  return Boolean(product && /^food tour(?:$|[ -])/i.test(product.name.trim()));
}
