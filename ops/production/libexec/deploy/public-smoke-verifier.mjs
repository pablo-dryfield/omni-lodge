import http from 'node:http';
import https from 'node:https';

const RELEASE_ID_PATTERN = /^omnilodge-r[1-9][0-9]*-a[1-9][0-9]*-[0-9a-f]{12}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const HASHED_MAIN_ASSET_PATTERN = /^\/static\/js\/main\.[A-Za-z0-9_-]{8,}\.js$/;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 512 * 1024;

export const DEFAULT_PUBLIC_SMOKE_TARGETS = Object.freeze({
  applicationOrigin: 'https://omni-lodge.com',
  transactionOrigin: 'https://transaction.omni-lodge.com',
  counterOrigin: 'https://counter.omni-lodge.com',
});

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const validateExpectedRelease = ({ releaseId, sourceSha }) => {
  invariant(typeof releaseId === 'string' && RELEASE_ID_PATTERN.test(releaseId), 'Public smoke expected release ID is invalid');
  invariant(typeof sourceSha === 'string' && SOURCE_SHA_PATTERN.test(sourceSha), 'Public smoke expected source SHA is invalid');
  invariant(releaseId.endsWith(sourceSha.slice(0, 12)), 'Public smoke release ID is not bound to its source SHA');
};

const normalizeOrigin = (origin, label) => {
  const parsed = new URL(origin);
  invariant(parsed.protocol === 'https:' || parsed.protocol === 'http:', `${label} origin must be HTTP(S)`);
  invariant(parsed.username === '' && parsed.password === '', `${label} origin must not contain credentials`);
  invariant(parsed.pathname === '/' && parsed.search === '' && parsed.hash === '', `${label} origin must not include a path, query, or hash`);
  return parsed.origin;
};

const createSmokeUrl = ({ origin, pathname }) => {
  invariant(typeof pathname === 'string' && pathname.startsWith('/'), 'Public smoke path must be absolute');
  const url = new URL(pathname, origin);
  invariant(url.username === '' && url.password === '', 'Public smoke URL must not contain credentials');
  invariant(url.hash === '', 'Public smoke URL must not contain a fragment');
  return url.toString();
};

export const requestPublicSmokeUrl = async ({
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  responseLimitBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
} = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const client = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
  if (client === null) {
    reject(new Error('Public smoke URL must use HTTP(S)'));
    return;
  }

  const request = client.request({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: `${parsed.pathname}${parsed.search}`,
    method: 'GET',
    timeout: timeoutMs,
    headers: {
      Accept: '*/*',
      Connection: 'close',
      'User-Agent': 'OmniLodgeDeploymentPublicSmoke/1',
    },
  }, (response) => {
    const chunks = [];
    let totalBytes = 0;
    response.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > responseLimitBytes) {
        request.destroy(new Error(`Public smoke response exceeded ${responseLimitBytes} bytes: ${parsed.pathname}`));
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
    request.destroy(new Error(`Public smoke request timed out: ${parsed.pathname}`));
  });
  request.once('error', reject);
  request.end();
});

const contentType = (response) => String(response.headers?.['content-type'] ?? '').toLowerCase();

const parseJsonBody = ({ response, label }) => {
  invariant(typeof response.body === 'string' && response.body.length > 0, `${label} response body is empty`);
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`${label} response is not JSON`, { cause: error });
  }
};

const releaseFromObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const candidate of [
    value.releaseId,
    value.release,
    value.version,
    value.build?.release,
    value.build?.releaseId,
  ]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
};

const requireRelease = ({
  body,
  releaseId,
  sourceSha,
  label,
  runtimeMode = 'primary',
}) => {
  invariant(body?.release?.id === releaseId, `${label} release ID does not match`);
  invariant(body?.release?.gitSha === sourceSha, `${label} source SHA does not match`);
  invariant(body?.release?.runtimeMode === runtimeMode, `${label} runtime mode does not match`);
  return Object.freeze({
    id: body.release.id,
    gitSha: body.release.gitSha,
    runtimeMode: body.release.runtimeMode,
  });
};

const validateBackendLive = ({ response, releaseId, sourceSha }) => {
  invariant(response.statusCode === 200, `API liveness returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label: 'API liveness' });
  invariant(body?.status === 'ok' && body.live === true, 'API liveness response is not live');
  return Object.freeze({
    live: true,
    release: requireRelease({
      body,
      releaseId,
      sourceSha,
      label: 'API liveness',
    }),
  });
};

const validateBackendReady = ({ response, releaseId, sourceSha }) => {
  invariant(response.statusCode === 200, `API readiness returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label: 'API readiness' });
  invariant(body?.status === 'ok' && body.ready === true, 'API readiness response is not ready');
  invariant(body?.checks?.configuration?.ok === true, 'API readiness configuration check is not ok');
  invariant(body?.checks?.database?.ok === true, 'API readiness database check is not ok');
  return Object.freeze({
    ready: true,
    release: requireRelease({
      body,
      releaseId,
      sourceSha,
      label: 'API readiness',
    }),
    checks: Object.freeze({
      configuration: true,
      database: true,
    }),
  });
};

const validateUiHealth = ({ response, releaseId }) => {
  invariant(response.statusCode === 200, `UI health returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label: 'UI health' });
  invariant(body?.status === 'ok' && body.service === 'ui-server', 'UI health response is not the UI server');
  invariant(body.release === releaseId, 'UI health release does not match');
  invariant(body.artifactValidation?.status === 'valid', 'UI health artifact validation is not valid');
  invariant(typeof body.artifactValidation?.mainAsset === 'string' && body.artifactValidation.mainAsset.startsWith('/'), 'UI health main asset is invalid');
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

const validateAssetManifest = ({ response, releaseId }) => {
  invariant(response.statusCode === 200, `asset-manifest.json returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label: 'asset-manifest.json' });
  const release = releaseFromObject(body);
  invariant(release === releaseId, 'asset-manifest.json release does not match');
  const mainAsset = body?.files?.['main.js'];
  invariant(typeof mainAsset === 'string' && HASHED_MAIN_ASSET_PATTERN.test(mainAsset), 'asset-manifest.json main asset is not content hashed');
  invariant(Array.isArray(body.entrypoints) && body.entrypoints.includes(mainAsset), 'asset-manifest.json entrypoints do not include the main asset');
  return Object.freeze({
    release,
    mainAsset,
    entrypointCount: body.entrypoints.length,
  });
};

const validateUiIndex = ({ response, mainAsset }) => {
  invariant(response.statusCode === 200, `UI index returned HTTP ${response.statusCode}`);
  invariant(contentType(response).includes('text/html'), 'UI index did not return HTML');
  invariant(/<div\b[^>]*\bid=["']root["']/i.test(response.body), 'UI index is not the OmniLodge application shell');
  invariant(response.body.includes(mainAsset), 'UI index does not reference the target main asset');
  return Object.freeze({ servedApplicationShell: true, referencesMainAsset: true });
};

const validateWebManifest = ({ response, label }) => {
  invariant(response.statusCode === 200, `${label} returned HTTP ${response.statusCode}`);
  const body = parseJsonBody({ response, label });
  invariant(typeof body.name === 'string' && body.name.trim().length > 0, `${label} name is missing`);
  invariant(typeof body.start_url === 'string' && body.start_url.trim().length > 0, `${label} start_url is missing`);
  invariant(typeof body.display === 'string' && body.display.trim().length > 0, `${label} display is missing`);
  invariant(Array.isArray(body.icons) && body.icons.length > 0, `${label} icons are missing`);
  return Object.freeze({
    manifestName: body.name,
    startUrl: body.start_url,
    iconCount: body.icons.length,
  });
};

const validateServiceWorker = ({ response, releaseId }) => {
  invariant(response.statusCode === 200, `service-worker.js returned HTTP ${response.statusCode}`);
  const type = contentType(response);
  invariant(type.includes('javascript') || type.includes('text/plain') || type === '', 'service-worker.js did not return JavaScript');
  invariant(/self\.addEventListener\s*\(/.test(response.body), 'service-worker.js does not contain a service-worker event handler');
  return Object.freeze({
    servedServiceWorker: true,
    mentionsRelease: response.body.includes(releaseId),
  });
};

const validateSourceMapDenied = ({ response, label }) => {
  invariant(response.statusCode === 404, `${label} source-map probe returned HTTP ${response.statusCode}`);
  return Object.freeze({ publicSourceMapsDenied: true });
};

const validateHtmlPage = ({ response, label }) => {
  invariant(response.statusCode === 200, `${label} returned HTTP ${response.statusCode}`);
  invariant(contentType(response).includes('text/html'), `${label} did not return HTML`);
  return Object.freeze({ servedHtml: true });
};

const check = async ({
  name,
  url,
  request,
  validate,
}) => {
  const response = await request({ url });
  const result = validate(response);
  return Object.freeze({
    name,
    url,
    statusCode: response.statusCode,
    ...result,
  });
};

export const runPublicSmokeChecks = async ({
  releaseId,
  sourceSha,
  targets = DEFAULT_PUBLIC_SMOKE_TARGETS,
  now = () => new Date(),
  request = requestPublicSmokeUrl,
} = {}) => {
  validateExpectedRelease({ releaseId, sourceSha });
  const applicationOrigin = normalizeOrigin(targets.applicationOrigin, 'application');
  const transactionOrigin = normalizeOrigin(targets.transactionOrigin, 'transaction companion');
  const counterOrigin = normalizeOrigin(targets.counterOrigin, 'counter companion');
  const startedAtUtc = now().toISOString();

  const apiLive = await check({
    name: 'api-live',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/api/health/live' }),
    request,
    validate: (response) => validateBackendLive({ response, releaseId, sourceSha }),
  });
  const apiReady = await check({
    name: 'api-ready',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/api/health/ready' }),
    request,
    validate: (response) => validateBackendReady({ response, releaseId, sourceSha }),
  });
  const uiHealth = await check({
    name: 'ui-health',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/healthz' }),
    request,
    validate: (response) => validateUiHealth({ response, releaseId }),
  });
  const assetManifest = await check({
    name: 'ui-asset-manifest',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/asset-manifest.json' }),
    request,
    validate: (response) => validateAssetManifest({ response, releaseId }),
  });
  const mainAsset = assetManifest.mainAsset;
  invariant(uiHealth.artifactValidation.mainAsset === mainAsset, 'UI health and asset manifest disagree on the main asset');
  const uiIndex = await check({
    name: 'ui-index',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/' }),
    request,
    validate: (response) => validateUiIndex({ response, mainAsset }),
  });
  const uiManifest = await check({
    name: 'ui-manifest',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/manifest.json' }),
    request,
    validate: (response) => validateWebManifest({ response, label: 'manifest.json' }),
  });
  const serviceWorker = await check({
    name: 'ui-service-worker',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: '/service-worker.js' }),
    request,
    validate: (response) => validateServiceWorker({ response, releaseId }),
  });
  const sourceMapProbe = await check({
    name: 'ui-source-map-denial',
    url: createSmokeUrl({ origin: applicationOrigin, pathname: `${mainAsset}.map` }),
    request,
    validate: (response) => validateSourceMapDenied({ response, label: 'UI main asset' }),
  });
  const transactionHome = await check({
    name: 'transaction-home',
    url: createSmokeUrl({ origin: transactionOrigin, pathname: '/' }),
    request,
    validate: (response) => validateHtmlPage({ response, label: 'transaction companion home' }),
  });
  const transactionInstall = await check({
    name: 'transaction-install',
    url: createSmokeUrl({ origin: transactionOrigin, pathname: '/finance/new-transaction/install.html' }),
    request,
    validate: (response) => validateHtmlPage({ response, label: 'transaction companion install page' }),
  });
  const transactionManifest = await check({
    name: 'transaction-manifest',
    url: createSmokeUrl({ origin: transactionOrigin, pathname: '/finance/new-transaction/new-transaction.webmanifest' }),
    request,
    validate: (response) => validateWebManifest({ response, label: 'transaction companion manifest' }),
  });
  const counterHome = await check({
    name: 'counter-home',
    url: createSmokeUrl({ origin: counterOrigin, pathname: '/' }),
    request,
    validate: (response) => validateHtmlPage({ response, label: 'counter companion home' }),
  });
  const counterInstall = await check({
    name: 'counter-install',
    url: createSmokeUrl({ origin: counterOrigin, pathname: '/counters/new-counter/install.html' }),
    request,
    validate: (response) => validateHtmlPage({ response, label: 'counter companion install page' }),
  });
  const counterManifest = await check({
    name: 'counter-manifest',
    url: createSmokeUrl({ origin: counterOrigin, pathname: '/counters/new-counter/new-counter.webmanifest' }),
    request,
    validate: (response) => validateWebManifest({ response, label: 'counter companion manifest' }),
  });

  return Object.freeze({
    schemaVersion: 1,
    releaseId,
    sourceSha,
    startedAtUtc,
    completedAtUtc: now().toISOString(),
    targets: Object.freeze({
      applicationOrigin,
      transactionOrigin,
      counterOrigin,
    }),
    api: Object.freeze({
      live: apiLive,
      ready: apiReady,
    }),
    ui: Object.freeze({
      health: uiHealth,
      assetManifest,
      index: uiIndex,
      manifest: uiManifest,
      serviceWorker,
      sourceMapProbe,
    }),
    companions: Object.freeze({
      transaction: Object.freeze({
        home: transactionHome,
        install: transactionInstall,
        manifest: transactionManifest,
      }),
      counter: Object.freeze({
        home: counterHome,
        install: counterInstall,
        manifest: counterManifest,
      }),
    }),
  });
};
