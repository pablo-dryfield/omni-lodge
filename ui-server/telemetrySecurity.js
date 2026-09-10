export const UI_SERVER_TELEMETRY_SECRET_HEADER = 'X-OmniLodge-Internal-Telemetry';
export const MIN_UI_SERVER_TELEMETRY_SECRET_LENGTH = 32;

const isLoopbackHost = (hostname) => {
  const normalized = String(hostname ?? '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const isSecureTelemetryEndpoint = (endpoint) => {
  try {
    const parsed = new URL(String(endpoint));
    if (parsed.username || parsed.password) return false;
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  } catch {
    return false;
  }
};

export const normalizeUiServerTelemetrySecret = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized.length >= MIN_UI_SERVER_TELEMETRY_SECRET_LENGTH ? normalized : null;
};

export const buildUiServerTelemetryHeaders = ({ endpoint, secret }) => {
  const normalizedSecret = normalizeUiServerTelemetrySecret(secret);
  if (!normalizedSecret) {
    throw new Error('UI server telemetry secret is not configured securely.');
  }
  if (!isSecureTelemetryEndpoint(endpoint)) {
    throw new Error('UI server telemetry credentials require HTTPS or a loopback endpoint.');
  }
  return {
    'Content-Type': 'application/json',
    // Informational only. API trust comes exclusively from the secret below.
    'X-OmniLodge-Telemetry': '1',
    [UI_SERVER_TELEMETRY_SECRET_HEADER]: normalizedSecret,
  };
};

export const buildUiServerTelemetryRequest = ({ endpoint, secret, body, signal }) => ({
  method: 'POST',
  headers: buildUiServerTelemetryHeaders({ endpoint, secret }),
  body,
  signal,
  // Never forward the private server-to-server credential to a redirect target.
  redirect: 'error',
});

export const stripInboundTelemetryCredential = (proxyRequest) => {
  try {
    proxyRequest?.removeHeader?.(UI_SERVER_TELEMETRY_SECRET_HEADER);
  } catch {
    // Header stripping must not turn a malformed request into a process crash.
  }
};
