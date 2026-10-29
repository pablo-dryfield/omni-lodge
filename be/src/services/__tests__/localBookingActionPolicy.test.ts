jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({ hasModuleActionPermission: jest.fn() }));
import type UserType from '../../models/UserType.js';
import Common from '../../__mocks__/sequelizeModelStub';
import Product from '../../models/Product.js';
import ProductType from '../../models/ProductType.js';
import Booking from '../../models/Booking.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import { getAllowedProductTypeIds } from '../productScopeService.js';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware.js';
import { assertLocalBookingActionAccess, isLocalActionPlatform } from '../localBookingActionPolicy.js';
const req = { authContext: { id: 7, userTypeId: 2, roleSlug: 'owner' } } as AuthenticatedRequest;
const booking = { id: 42, platform: 'viator', productId: 9 } as Booking;
const roleModel = Common as { findByPk: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(hasModuleActionPermission).mockResolvedValue(true);
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue(null);
  roleModel.findByPk.mockResolvedValue({ slug: 'owner', status: true } as UserType);
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 9, productTypeId: 1 } as Product);
  jest.mocked(ProductType.findByPk).mockResolvedValue({ id: 1, name: 'Pub Crawl' } as ProductType);
});
it.each(['viator', 'rezdy', 'getyourguide', 'freetour', 'civitatis', 'fareharbor', 'xperiencepoland', 'airbnb', 'ecwid', 'new-provider'])(
  'supports external channel %s without product-title restrictions', async platform => {
    expect(isLocalActionPlatform(platform)).toBe(true);
    await expect(assertLocalBookingActionAccess(req, { ...booking, platform } as Booking)).resolves.toBe('STOREFRONT');
  });
it.each(['owner', 'admin', 'administrator', 'manager', 'mgr'])('permits current global management role %s', async slug => {
  roleModel.findByPk.mockResolvedValue({ slug, status: true } as UserType);
  await expect(assertLocalBookingActionAccess(req, booking)).resolves.toBe('STOREFRONT');
});
it.each(['guide', 'assistant-manager', 'food-tour-owner', 'food-tour-manager', 'unrelated'])(
  'does not turn a global %s into an unrestricted manager', async slug => {
    roleModel.findByPk.mockResolvedValue({ slug, status: true } as UserType);
    await expect(assertLocalBookingActionAccess(req, booking)).rejects.toMatchObject({ status: 403 });
  });
it.each(['direct', 'omnilodge', 'manual', 'unknown', ''])(
  'does not bypass owned payment workflows for %s', async platform => {
    expect(isLocalActionPlatform(platform)).toBe(false);
    await expect(assertLocalBookingActionAccess(req, { ...booking, platform } as Booking)).rejects.toMatchObject({ status: 400 });
  });
it.each(['food-tour-owner', 'food-tour-manager'])('allows scoped %s only on actual Food Tour products', async slug => {
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
  roleModel.findByPk.mockResolvedValue({ slug, status: true } as UserType);
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 9, productTypeId: 3 } as Product);
  jest.mocked(ProductType.findByPk).mockResolvedValue({ id: 3, name: 'Food Tour' } as ProductType);
  await expect(assertLocalBookingActionAccess(req, booking)).resolves.toBe('DIRECT_BOOKINGS');
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 9, productTypeId: 1 } as Product);
  await expect(assertLocalBookingActionAccess(req, booking)).rejects.toMatchObject({ status: 403 });
});
it('fails closed for inactive roles, missing permission, missing products, and mixed scopes', async () => {
  jest.mocked(hasModuleActionPermission).mockResolvedValue(false);
  await expect(assertLocalBookingActionAccess(req, booking)).rejects.toMatchObject({ status: 403 });
  jest.mocked(hasModuleActionPermission).mockResolvedValue(true);
  roleModel.findByPk.mockResolvedValue({ slug: 'owner', status: false } as UserType);
  await expect(assertLocalBookingActionAccess(req, booking)).rejects.toMatchObject({ status: 403 });
  roleModel.findByPk.mockResolvedValue({ slug: 'food-tour-owner', status: true } as UserType);
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3, 1]);
  await expect(assertLocalBookingActionAccess(req, booking)).rejects.toMatchObject({ status: 403 });
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]); jest.mocked(Product.findByPk).mockResolvedValue(null);
  await expect(assertLocalBookingActionAccess(req, booking)).rejects.toMatchObject({ status: 403 });
});
