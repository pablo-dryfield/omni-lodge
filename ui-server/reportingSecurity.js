const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_PUBLIC_ORIGIN = 'https://omni-lodge.com';
const DEFAULT_DEVELOPMENT_ORIGIN = 'http://localhost:3005';

export const UI_CONTENT_SECURITY_POLICY = [
  "script-src 'self' https://connect.facebook.net https://static.cloudflareinsights.com/beacon.min.js https://static.cloudflareinsights.com/beacon.min.js/",
  "connect-src 'self' https://omni-lodge.com https://connect.facebook.net https://graph.facebook.com https://www.facebook.com https://web.facebook.com https://www.googleapis.com https://content.googleapis.com",
  "frame-src 'self' blob: data: https://www.facebook.com https://web.facebook.com",
  'report-uri /api/client-errors/browser-reports',
  'report-to csp-endpoint',
].join('; ');

const normalizeHostname = (value) => String(value || '')
  .toLowerCase()
  .replace(/^\[|\]$/g, '');

export const resolvePublicReportingOrigin = ({
  configuredOrigin,
  environment = 'production',
  developmentOrigin = DEFAULT_DEVELOPMENT_ORIGIN,
} = {}) => {
  const production = String(environment).toLowerCase() === 'production';
  const fallbackOrigin = production ? DEFAULT_PUBLIC_ORIGIN : developmentOrigin;
  try {
    const candidate = new URL(configuredOrigin || fallbackOrigin);
    const secure = candidate.protocol === 'https:';
    const localDevelopment = !production
      && candidate.protocol === 'http:'
      && LOOPBACK_HOSTS.has(normalizeHostname(candidate.hostname));
    if ((!secure && !localDevelopment) || candidate.username || candidate.password) {
      throw new Error('Unsafe reporting origin');
    }
    return candidate.origin;
  } catch {
    if (!production) {
      try {
        const localFallback = new URL(developmentOrigin || DEFAULT_DEVELOPMENT_ORIGIN);
        if (
          localFallback.protocol === 'http:'
          && LOOPBACK_HOSTS.has(normalizeHostname(localFallback.hostname))
          && !localFallback.username
          && !localFallback.password
        ) {
          return localFallback.origin;
        }
      } catch {
        // Fall through to the fixed loopback default.
      }
      return DEFAULT_DEVELOPMENT_ORIGIN;
    }
    return DEFAULT_PUBLIC_ORIGIN;
  }
};

export const buildBrowserReportUrl = (options = {}) =>
  new URL(
    '/api/client-errors/browser-reports',
    resolvePublicReportingOrigin(options),
  ).toString();
