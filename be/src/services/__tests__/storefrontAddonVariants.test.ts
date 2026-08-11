import { normalizeStorefrontAddonVariants } from '../storefrontCommerceService';

jest.mock('../../models/Addon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Channel.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ChannelProductPrice.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductPrice.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontPromotion.js', () => ({ __esModule: true, default: {} }));
jest.mock('../inventoryService.js', () => ({
  getAddonInventoryAvailability: jest.fn(),
}));

const inventory = {
  addonId: 2,
  tracked: true,
  availableQuantity: 200,
  inStock: true,
  variantSelectionRequired: true,
  variants: [
    { variant: 'S', availableQuantity: 41, inStock: true },
    { variant: 'M', availableQuantity: 40, inStock: true },
    { variant: 'L', availableQuantity: 49, inStock: true },
    { variant: 'XL', availableQuantity: 50, inStock: true },
    { variant: 'XXL', availableQuantity: 20, inStock: true },
  ],
};

describe('normalizeStorefrontAddonVariants', () => {
  it('accepts and normalizes multiple T-shirt sizes whose quantities match the add-on total', () => {
    expect(
      normalizeStorefrontAddonVariants(
        [
          { value: 'S', quantity: 2 },
          { value: 'm', quantity: 2 },
          { value: 'L', quantity: 1 },
          { value: 'XL', quantity: 1 },
          { value: 'XXL', quantity: 1 },
        ],
        'T-Shirts',
        7,
        inventory,
      ),
    ).toEqual([
      { value: 'S', quantity: 2 },
      { value: 'M', quantity: 2 },
      { value: 'L', quantity: 1 },
      { value: 'XL', quantity: 1 },
      { value: 'XXL', quantity: 1 },
    ]);
  });

  it('rejects size quantities that do not equal the requested add-on quantity', () => {
    expect(() =>
      normalizeStorefrontAddonVariants(
        [
          { value: 'S', quantity: 2 },
          { value: 'M', quantity: 2 },
        ],
        'T-Shirts',
        7,
        inventory,
      ),
    ).toThrow('T-Shirts size quantities must add up to 7; received 4.');
  });

  it('rejects a size quantity greater than the available stock', () => {
    expect(() =>
      normalizeStorefrontAddonVariants(
        [{ value: 'XXL', quantity: 21 }],
        'T-Shirts',
        21,
        inventory,
      ),
    ).toThrow('T-Shirts size XXL only has 20 available.');
  });
});
