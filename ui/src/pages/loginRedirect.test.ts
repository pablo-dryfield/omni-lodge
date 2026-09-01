import { getPostLoginDestination } from './loginRedirect';

describe('getPostLoginDestination', () => {
  it('preserves a protected PWA deep link after login', () => {
    expect(
      getPostLoginDestination('owner', {
        pathname: '/finance/transactions',
        search: '?transactionModal=create',
        hash: '',
      }),
    ).toBe('/finance/transactions?transactionModal=create');
  });

  it('preserves the New Counter companion deep link after login', () => {
    expect(
      getPostLoginDestination('manager', {
        pathname: '/counters',
        search: '?mode=create&pwa=new-counter',
        hash: '',
      }),
    ).toBe('/counters?mode=create&pwa=new-counter');
  });

  it('preserves the existing affiliate landing-page policy', () => {
    expect(
      getPostLoginDestination(' Affiliate ', {
        pathname: '/finance/transactions',
        search: '?transactionModal=create',
        hash: '',
      }),
    ).toBe('/affiliates');
  });

  it.each([
    'https://attacker.example/finance/transactions',
    '//attacker.example/finance/transactions',
    '/\\attacker.example/finance/transactions',
  ])('falls back to the homepage for an unsafe destination: %s', (pathname) => {
    expect(
      getPostLoginDestination('owner', {
        pathname,
        search: '?transactionModal=create',
        hash: '',
      }),
    ).toBe('/');
  });

  it('keeps a safe hash and ignores malformed suffixes', () => {
    expect(
      getPostLoginDestination('manager', {
        pathname: '/finance/transactions',
        search: 'transactionModal=create',
        hash: 'details',
      }),
    ).toBe('/finance/transactions');

    expect(
      getPostLoginDestination('manager', {
        pathname: '/finance/transactions',
        search: '?transactionModal=create',
        hash: '#details',
      }),
    ).toBe('/finance/transactions?transactionModal=create#details');
  });
});
