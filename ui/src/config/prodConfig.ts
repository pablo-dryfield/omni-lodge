import { getProductionApiBaseUrl } from '../utils/newTransactionPwa';

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

const config = {
    // Keep authentication on the primary origin. Its existing host-only,
    // HttpOnly session cookie can then authenticate the companion PWA without
    // widening that cookie to every OmniLodge subdomain.
    baseURL: getProductionApiBaseUrl(hostname),
};

export default config;
