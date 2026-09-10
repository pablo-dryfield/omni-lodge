const DEFAULT_PRODUCTION_PROXY_HOPS = 2;
const MAX_TRUSTED_PROXY_HOPS = 5;

/**
 * OmniLodge production requests normally traverse Cloudflare and ui-server
 * before the API. A bounded numeric value prevents accidental trust of an
 * arbitrary X-Forwarded-For chain.
 */
export const resolveProductionTrustProxyHops = (value: unknown): number => {
  if (value == null || value === '') return DEFAULT_PRODUCTION_PROXY_HOPS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TRUSTED_PROXY_HOPS) {
    return DEFAULT_PRODUCTION_PROXY_HOPS;
  }
  return parsed;
};
