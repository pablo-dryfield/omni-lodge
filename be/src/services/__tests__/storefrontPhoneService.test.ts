import { normalizeStorefrontPhone } from '../storefrontPhoneService.js';

describe('storefront phone normalization', () => {
  it('recognizes an international autofill number and replaces a stale country', () => {
    expect(normalizeStorefrontPhone('+44 20 7946 0958', 'PL')).toEqual({
      phone: '+442079460958',
      countryCode: 'GB',
    });
  });

  it('recognizes the international 00 prefix', () => {
    expect(normalizeStorefrontPhone('0049 30 901820', null)).toEqual({
      phone: '+4930901820',
      countryCode: 'DE',
    });
  });

  it('formats a national number using the selected country', () => {
    expect(normalizeStorefrontPhone('791 847 981', 'pl')).toEqual({
      phone: '+48791847981',
      countryCode: 'PL',
    });
  });

  it('preserves a number when no country can be inferred', () => {
    expect(normalizeStorefrontPhone('791847981', null)).toEqual({
      phone: '791847981',
      countryCode: null,
    });
  });
});
