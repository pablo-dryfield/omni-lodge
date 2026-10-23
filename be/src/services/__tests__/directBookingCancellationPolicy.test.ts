jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({ hasModuleActionPermission: jest.fn() }));
import type Booking from '../../models/Booking';
import type UserType from '../../models/UserType';
import Common from '../../__mocks__/sequelizeModelStub';
import ProductType from '../../models/ProductType';
import Product from '../../models/Product';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware';
import { getAllowedProductTypeIds } from '../productScopeService';
import { assertDirectBookingCancellationAccess, assertScopedBookingRefundAccess, isDirectBooking } from '../directBookingCancellationPolicy';

const booking = (fields = {}) => ({ id: 10627, platform: 'direct', productId: 49,
  productName: 'Krakow: Late Night Bites Polish Street Food and Drinks Tour', ...fields } as Booking);
const request = (roleSlug: string) => ({ authContext: { id: 215, userTypeId: 16, roleSlug } } as AuthenticatedRequest);
const roleModel = Common as { findByPk: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue(null);
  roleModel.findByPk.mockResolvedValue({ id: 16, slug: 'food-tour-owner', status: true } as UserType);
  jest.mocked(ProductType.findByPk).mockResolvedValue({ id: 3, name: 'Food Tour Krakow' } as ProductType);
  jest.mocked(Product.findByPk).mockResolvedValue({ id: 49, productTypeId: 3 } as Product);
  jest.mocked(hasModuleActionPermission).mockResolvedValue(true);
});
it.each(['owner', 'admin', 'administrator', 'manager', ' Administrator ', 'mgr'])(
  'allows global %s to cancel Direct bookings regardless of product title or product assignment', async role => {
    await expect(assertDirectBookingCancellationAccess(request(role), booking({ productId: null, productName: 'Other experience' })))
      .resolves.toBeUndefined();
    expect(Product.findByPk).not.toHaveBeenCalled();
  });
it.each(['assistant-manager', 'guide', 'food-tour-owner', 'food-tour-manager', 'food-tour-guide', ''])(
  'does not grant a global role %s cancellation authority', async role => {
    await expect(assertDirectBookingCancellationAccess(request(role), booking())).rejects.toMatchObject({ status: 403 });
  });
it.each(['food-tour-owner', 'food-tour-manager'])(
  'allows current scoped %s to cancel Late Bites using its actual product type', async slug => {
    jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
    roleModel.findByPk.mockResolvedValue({ slug, status: true } as UserType);
    await expect(assertDirectBookingCancellationAccess(request(slug), booking())).resolves.toBeUndefined();
    expect(hasModuleActionPermission).toHaveBeenCalledWith(expect.anything(), 'booking-management', 'update');
  });
it.each([
  { scope: [3, 1] }, { scope: [] }, { productId: null }, { actualProductType: 1 },
  { actualProductType: null }, { productTypeName: 'Pub Crawl' }, { productTypeName: 'Food Tours' },
  { roleSlug: 'food-tour-guide' }, { roleSlug: 'owner' }, { roleSlug: null }, { active: false },
  { permission: false }, { platform: 'ecwid' }, { platform: 'viator' },
])('rejects an unsafe scoped request %j', async scenario => {
  const values = scenario as Record<string, any>;
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue(values.scope ?? [3]);
  roleModel.findByPk.mockResolvedValue({ slug: 'roleSlug' in values ? values.roleSlug : 'food-tour-owner', status: values.active ?? true } as UserType);
  jest.mocked(Product.findByPk).mockResolvedValue(values.actualProductType === null ? null
    : { id: 49, productTypeId: values.actualProductType ?? 3 } as Product);
  jest.mocked(ProductType.findByPk).mockResolvedValue({ name: values.productTypeName ?? 'Food Tour' } as ProductType);
  jest.mocked(hasModuleActionPermission).mockResolvedValue(values.permission ?? true);
  await expect(assertDirectBookingCancellationAccess(request('food-tour-owner'), booking({
    productName: 'Food Tour (misleading title)',
    ...('productId' in values ? { productId: values.productId } : {}),
    ...('platform' in values ? { platform: values.platform } : {}),
  }))).rejects.toMatchObject({ status: 403 });
});
it.each(['food-tour-owner', 'food-tour-manager'])(
  'allows current scoped %s to refund its OmniLodge Food Tour product', async slug => {
    jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
    roleModel.findByPk.mockResolvedValue({ slug, status: true } as UserType);
    await expect(assertScopedBookingRefundAccess(request(slug), booking({ platform: 'omnilodge' }))).resolves.toBeUndefined();
    expect(Product.findByPk).toHaveBeenCalledWith(49, expect.anything());
  },
);
it('keeps legacy global partial-refund access without granting scoped guide access', async () => {
  await expect(assertScopedBookingRefundAccess(request('assistant-manager'), booking())).resolves.toBeUndefined();
  jest.mocked(getAllowedProductTypeIds).mockResolvedValue([3]);
  roleModel.findByPk.mockResolvedValue({ slug: 'food-tour-guide', status: true } as UserType);
  await expect(assertScopedBookingRefundAccess(request('food-tour-guide'), booking())).rejects.toMatchObject({ status: 403 });
});
it('fails closed if scope lookup fails', async () => {
  jest.mocked(getAllowedProductTypeIds).mockRejectedValue(new Error('Unavailable'));
  await expect(assertDirectBookingCancellationAccess(request('owner'), booking())).rejects.toThrow('Unavailable');
});
it('preserves existing global storefront behavior without treating it as Direct', async () => {
  expect(isDirectBooking(booking({ platform: 'omnilodge' }))).toBe(false);
  await expect(assertDirectBookingCancellationAccess(request('guide'), booking({ platform: 'omnilodge' })))
    .resolves.toBeUndefined();
});
