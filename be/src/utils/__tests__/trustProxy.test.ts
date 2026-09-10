import { resolveProductionTrustProxyHops } from '../trustProxy.js';

describe('production trust proxy configuration', () => {
  it('defaults to the Cloudflare plus ui-server topology', () => {
    expect(resolveProductionTrustProxyHops(undefined)).toBe(2);
    expect(resolveProductionTrustProxyHops('')).toBe(2);
  });

  it('accepts only a small bounded integer hop count', () => {
    expect(resolveProductionTrustProxyHops('1')).toBe(1);
    expect(resolveProductionTrustProxyHops('3')).toBe(3);
    expect(resolveProductionTrustProxyHops('0')).toBe(0);
    expect(resolveProductionTrustProxyHops('6')).toBe(2);
    expect(resolveProductionTrustProxyHops('-1')).toBe(2);
    expect(resolveProductionTrustProxyHops('all')).toBe(2);
  });
});
