import http from 'node:http';
import https from 'node:https';

const RELEASE_ID_PATTERN = /^omnilodge-r[1-9][0-9]*-a[1-9][0-9]*-[0-9a-f]{12}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 256 * 1024;
const DEFAULT_READINESS_RETRY_WINDOW_MS = 120 * 1000;
const DEFAULT_READINESS_RETRY_INTERVAL_MS = 2 * 1000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export const DEFAULT_MANAGED_ORIGIN_TARGETS = Object.freeze({
  backendOrigin: 'http://127.0.0.1:3001',
  uiOrigin: 'https://127.0.0.1:443',
  hostHeader: 'omni-lodge.com',
  tlsServername: 'omni-lodge.com',
  rejectUnauthorized: false,
});

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

const validateExpectedRelease = ({ releaseId, sourceSha }) => {
  invariant(typeof releaseId === 'string' && RELEASE_ID_PATTERN.test(releaseId), 'Managed origin expected release ID is invalid');
  invariant(typeof sourceSha === 'string' && SOURCE_SHA_PATTERN.test(sourceSha), 'Managed origin expected source SHA is invalid');
  invariant(releaseId.endsWith(sourceSha.slice(0, 12)), 'Managed origin release ID is not bound to its source SHA');
};

const normalizeLoopbackOrigin = (origin, label, allowedProtocols) => {
  const parsed = new URL(origin);
  invariant(allowedProtocols.includes(parsed.protocol), `${label} origin must use ${allowedProtocols.join(' or ')}`);
  invariant(parsed.username === '' && parsed.password === '', `${label} origin must not contain credentials`);
  invariant(parsed.pathname === '/' && parsed.search === '' && parsed.hash === '', `${label} origin must not include a path, query, or hash`);
  invariant(LOOPBACK_HOSTS.has(parsed.hostname), `${label} origin must be loopback`);
  return parsed.origin;
};

const normalizeHostHeader = (value) => {
  invariant(typeof value === 'string' && value.trim().length > 0, 'Managed origin host header is required');
  const trimmed = value.trim();
  invariant(!/[\r\n]/.test(trimmed), 'Managed origin host header must not contain control characters');
  return trimmed;
};

const normalizeTlsServername = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  invariant(typeof value === 'string' && value.trim().length > 0, 'Managed origin TLS servername must be a string');
  const trimmed = value.trim();
  invariant(!/[\r\n]/.test(trimmed), 'Managed origin TLS servername must not contain control characters');
  return trimmed;
};

const normalizeTargets = (targets = DEFAULT_MANAGED_ORIGIN_TARGETS) => Object.freeze({
  backendOrigin: normalizeLoopbackOrigin(
    targets.backendOrigin ?? DEFAULT_MANAGED_ORIGIN_TARGETS.backendOrigin,
    'backend',
    ['http:', 'https:'],
  ),
  uiOrigin: normalizeLoopbackOrigin(
    targets.uiOrigin ?? DEFAULT_MANAGED_ORIGIN_TARGETS.uiOrigin,
    'UI',
    ['https:'],
  ),
  hostHeader: normalizeHostHeader(targets.hostHeader ?? DEFAULT_MANAGED_ORIGIN_TARGETS.hostHeader),
  tlsServername: normalizeTlsServername(targets.tlsServername ?? DEFAULT_MANAGED_ORIGIN_TARGETS.tlsServername),
  rejectUnauthorized: targets.rejectUnauthorized ?? DEFAULT_MANAGED_ORIGIN_TARGETS.rejectUnauthorized,
});

const createReadinessUrl = ({ origin, pathname }) => {
  invariant(typeof pathname === 'string' && pathname.startsWith('/'), 'Managed origin readiness path must be absolute');
  const url = new URL(pathname, origin);
  invariant(url.username === '' && url.password === '', 'Managed origin readiness URL must not contain credentials');
  invariant(url.hash === '', 'Managed origin readiness URL must not contain a fragment');
  return url.toString();
};

export const requestManagedOriginUrl = async ({
  url,
  hostHeader = DEFAULT_MANAGED_ORIGIN_TARGETS.hostHeader,
  tlsServername = DEFAULT_MANAGED_ORIGIN_TARGETS.tlsServername,
  rejectUnauthorized = DEFAULT_MANAGED_ORIGIN_TARGETS.rejectUnauthorized,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  responseLimitBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
} = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const client = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
  if (client === null) {
    reject(new Error('Managed origin readiness URL must use HTTP(S)'));
    return;
  }

  const headers = {
    Accept: '*/*',
    Connection: 'close',
    'User-Agent': 'OmniLodgeDeploymentManagedOriginReadiness/1',
  };
  if (hostHeader) headers.Host = hostHeader;

  const request = client.request({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: `${parsed.pathname}${parsed.search}`,
    method: 'GET',
    timeout: timeoutMs,
    headers,
    ...(parsed.protocol === 'https:' ? {
      servername: tlsServername,
      rejectUnauthorized,
    } : {}),
  }, (response) => {
    const chunks = [];
    let totalBytes = 0;
    response.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > responseLimitBytes) {
        request.destroy(new Error(`Managed origin readiness response exceeded ${responseLimitBytes} bytes: ${parsed.pathname}`));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      resolve(Object.freeze({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
  });
  request.once('timeout', () => {
    request.destroy(new Error(`Managed origin readiness request timed out: ${parsed.pathname}`));
  });
  request.once('error', reject);
  request.end();
});

const parseJsonBody = ({ response, label }) => {
  invariant(typeof response.body === 'string' && response.body.length > 0, `${label} response body is empty`);
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`${label} response is not JSON`, { cause: error });
  }
};

const requireRelease = ({
  body,
  releaseId,
  sourceSha,
  label,
}) => {
  invariant(body?.release?.id === releaseId, `${label} release ID does not match`);
  invariant(body?.release?.gitSha === sourceSha, `${label} source SHA does not match`);
  invariant(body?.release?.runtimeMode === 'primary', `${label} runtime mode does not match`);
  return Object.freeze({
    id: body.release.id,
    gitSha: body.release.gitSha,
    runtimeMode: body.release.runtimeMode,
  });
};

const validateBackendReady = ({ response, releaseId, sourceSha, label }) => {
  invariant(response.statusCode === 200, `${label} returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label });
  invariant(body?.status === 'ok' && body.ready === true, `${label} response is not ready`);
  invariant(body?.checks?.configuration?.ok === true, `${label} configuration check is not ok`);
  invariant(body?.checks?.database?.ok === true, `${label} database check is not ok`);
  return Object.freeze({
    ready: true,
    release: requireRelease({
      body,
      releaseId,
      sourceSha,
      label,
    }),
    checks: Object.freeze({
      configuration: true,
      database: true,
    }),
  });
};

const validateBackendLive = ({ response, releaseId, sourceSha, label }) => {
  invariant(response.statusCode === 200, `${label} returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label });
  invariant(body?.status === 'ok' && body.live === true, `${label} response is not live`);
  return Object.freeze({
    live: true,
    release: requireRelease({
      body,
      releaseId,
      sourceSha,
      label,
    }),
  });
};

const validateUiHealth = ({ response, releaseId }) => {
  invariant(response.statusCode === 200, `UI origin health returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label: 'UI origin health' });
  invariant(body?.status === 'ok' && body.service === 'ui-server', 'UI origin health response is not the UI server');
  invariant(body.release === releaseId, 'UI origin health release does not match');
  invariant(body.artifactValidation?.status === 'valid', 'UI origin artifact validation is not valid');
  invariant(typeof body.artifactValidation?.mainAsset === 'string' && body.artifactValidation.mainAsset.startsWith('/'), 'UI origin main asset is invalid');
  return Object.freeze({
    release: body.release,
    artifactValidation: Object.freeze({
      status: body.artifactValidation.status,
      mainAsset: body.artifactValidation.mainAsset,
      assetCount: body.artifactValidation.assetCount,
      hashedAssetCount: body.artifactValidation.hashedAssetCount,
      pwaManifestCount: body.artifactValidation.pwaManifestCount,
    }),
  });
};

const check = async ({
  name,
  url,
  request,
  validate,
  hostHeader,
  tlsServername,
  rejectUnauthorized,
}) => {
  const response = await request({
    url,
    hostHeader,
    tlsServername,
    rejectUnauthorized,
  });
  const result = validate(response);
  return Object.freeze({
    name,
    url,
    statusCode: response.statusCode,
    ...result,
  });
};

const checkWithRetry = async ({
  name,
  url,
  request,
  validate,
  hostHeader,
  tlsServername,
  rejectUnauthorized,
  retryWindowMs,
  retryIntervalMs,
  wait,
  now,
}) => {
  const deadline = Date.now() + Math.max(0, retryWindowMs);
  const attempts = [];
  let attempt = 0;
  let lastError = null;

  for (;;) {
    attempt += 1;
    try {
      const result = await check({
        name,
        url,
        request,
        validate,
        hostHeader,
        tlsServername,
        rejectUnauthorized,
      });
      return Object.freeze({
        ...result,
        attempts: attempt,
        failedAttempts: Object.freeze(attempts),
      });
    } catch (error) {
      lastError = error;
      attempts.push(Object.freeze({
        attempt,
        attemptedAtUtc: now().toISOString(),
        ok: false,
        message: errorMessage(error),
      }));

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        const readiness = Object.freeze({
          name,
          url,
          attempts: Object.freeze(attempts),
          lastMessage: errorMessage(lastError),
        });
        const finalError = new Error(
          `${name} managed origin readiness check did not pass after ${attempt} attempt(s): ${errorMessage(lastError)}`,
          { cause: lastError },
        );
        Object.defineProperty(finalError, 'managedOriginReadiness', {
          value: readiness,
          enumerable: true,
          configurable: true,
        });
        throw finalError;
      }
      await wait(Math.min(retryIntervalMs, remainingMs));
    }
  }
};

export const runManagedOriginReadinessChecks = async ({
  releaseId,
  sourceSha,
  targets = DEFAULT_MANAGED_ORIGIN_TARGETS,
  now = () => new Date(),
  request = requestManagedOriginUrl,
  retryWindowMs = DEFAULT_READINESS_RETRY_WINDOW_MS,
  retryIntervalMs = DEFAULT_READINESS_RETRY_INTERVAL_MS,
  wait = delay,
} = {}) => {
  validateExpectedRelease({ releaseId, sourceSha });
  const normalizedTargets = normalizeTargets(targets);
  const startedAtUtc = now().toISOString();
  const readinessCheck = (options) => checkWithRetry({
    ...options,
    request,
    hostHeader: normalizedTargets.hostHeader,
    tlsServername: normalizedTargets.tlsServername,
    rejectUnauthorized: normalizedTargets.rejectUnauthorized,
    retryWindowMs,
    retryIntervalMs,
    wait,
    now,
  });

  const backendReady = await readinessCheck({
    name: 'backend-direct-ready',
    url: createReadinessUrl({
      origin: normalizedTargets.backendOrigin,
      pathname: '/api/health/ready',
    }),
    validate: (response) => validateBackendReady({
      response,
      releaseId,
      sourceSha,
      label: 'backend direct readiness',
    }),
  });

  const uiHealth = await readinessCheck({
    name: 'ui-origin-health',
    url: createReadinessUrl({
      origin: normalizedTargets.uiOrigin,
      pathname: '/healthz',
    }),
    validate: (response) => validateUiHealth({ response, releaseId }),
  });

  const uiApiLive = await readinessCheck({
    name: 'ui-origin-api-live',
    url: createReadinessUrl({
      origin: normalizedTargets.uiOrigin,
      pathname: '/api/health/live',
    }),
    validate: (response) => validateBackendLive({
      response,
      releaseId,
      sourceSha,
      label: 'UI origin API liveness',
    }),
  });

  return Object.freeze({
    schemaVersion: 1,
    releaseId,
    sourceSha,
    startedAtUtc,
    completedAtUtc: now().toISOString(),
    targets: normalizedTargets,
    backend: Object.freeze({
      ready: backendReady,
    }),
    ui: Object.freeze({
      health: uiHealth,
      apiLive: uiApiLive,
    }),
  });
};
