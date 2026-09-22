import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runPublicSmokeChecks,
} from './libexec/deploy/public-smoke-verifier.mjs';

const SOURCE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const RELEASE_ID = `omnilodge-r357-a1-${SOURCE_SHA.slice(0, 12)}`;
const MAIN_ASSET = '/static/js/main.1234abcd.js';
const TARGETS = Object.freeze({
  applicationOrigin: 'https://example.omnilodge.test',
  transactionOrigin: 'https://transaction.example.omnilodge.test',
  counterOrigin: 'https://counter.example.omnilodge.test',
});

const jsonResponse = (body, statusCode = 200) => Object.freeze({
  statusCode,
  headers: Object.freeze({ 'content-type': 'application/json; charset=utf-8' }),
  body: JSON.stringify(body),
});

const htmlResponse = (body, statusCode = 200) => Object.freeze({
  statusCode,
  headers: Object.freeze({ 'content-type': 'text/html; charset=utf-8' }),
  body,
});

const jsResponse = (body, statusCode = 200) => Object.freeze({
  statusCode,
  headers: Object.freeze({ 'content-type': 'application/javascript; charset=utf-8' }),
  body,
});

const createFixtureResponses = ({
  releaseId = RELEASE_ID,
  sourceSha = SOURCE_SHA,
  mainAsset = MAIN_ASSET,
  indexBody = `<!doctype html><html><head><script defer src="${MAIN_ASSET}"></script></head><body><div id="root"></div></body></html>`,
  sourceMapStatus = 404,
} = {}) => new Map([
  [`${TARGETS.applicationOrigin}/api/health/live`, jsonResponse({
    status: 'ok',
    live: true,
    release: {
      id: releaseId,
      gitSha: sourceSha,
      runtimeMode: 'primary',
    },
  })],
  [`${TARGETS.applicationOrigin}/api/health/ready`, jsonResponse({
    status: 'ok',
    ready: true,
    release: {
      id: releaseId,
      gitSha: sourceSha,
      runtimeMode: 'primary',
    },
    checks: {
      configuration: { ok: true, missing: [], invalid: [] },
      database: { ok: true },
    },
  })],
  [`${TARGETS.applicationOrigin}/healthz`, jsonResponse({
    status: 'ok',
    service: 'ui-server',
    release: releaseId,
    artifactValidation: {
      status: 'valid',
      mainAsset,
      assetCount: 12,
      hashedAssetCount: 9,
      pwaManifestCount: 3,
    },
  })],
  [`${TARGETS.applicationOrigin}/asset-manifest.json`, jsonResponse({
    release: releaseId,
    files: { 'main.js': mainAsset },
    entrypoints: [mainAsset],
  })],
  [`${TARGETS.applicationOrigin}/`, htmlResponse(indexBody)],
  [`${TARGETS.applicationOrigin}/manifest.json`, jsonResponse({
    name: 'OmniLodge',
    start_url: '/',
    display: 'standalone',
    icons: [{ src: '/logo.png', sizes: '192x192' }],
  })],
  [`${TARGETS.applicationOrigin}/service-worker.js`, jsResponse(`self.addEventListener('install', () => {}); const release = '${releaseId}';`)],
  [`${TARGETS.applicationOrigin}${mainAsset}.map`, Object.freeze({
    statusCode: sourceMapStatus,
    headers: Object.freeze({ 'content-type': 'text/plain' }),
    body: sourceMapStatus === 404 ? 'Not found' : '{}',
  })],
  [`${TARGETS.transactionOrigin}/`, htmlResponse('<!doctype html><div id="transaction-root"></div>')],
  [`${TARGETS.transactionOrigin}/finance/new-transaction/install.html`, htmlResponse('<!doctype html><p>Install transaction</p>')],
  [`${TARGETS.transactionOrigin}/finance/new-transaction/new-transaction.webmanifest`, jsonResponse({
    name: 'New Transaction',
    start_url: '/finance/new-transaction/install.html',
    display: 'standalone',
    icons: [{ src: '/icon.png', sizes: '192x192' }],
  })],
  [`${TARGETS.counterOrigin}/`, htmlResponse('<!doctype html><div id="counter-root"></div>')],
  [`${TARGETS.counterOrigin}/counters/new-counter/install.html`, htmlResponse('<!doctype html><p>Install counter</p>')],
  [`${TARGETS.counterOrigin}/counters/new-counter/new-counter.webmanifest`, jsonResponse({
    name: 'New Counter',
    start_url: '/counters/new-counter/install.html',
    display: 'standalone',
    icons: [{ src: '/icon.png', sizes: '192x192' }],
  })],
]);

const createRequester = (responses) => async ({ url }) => {
  const response = responses.get(url);
  if (!response) throw new Error(`Unexpected smoke URL: ${url}`);
  return response;
};

test('public smoke verifier proves the released API, UI, and companion PWA surfaces', async () => {
  const responses = createFixtureResponses();
  const result = await runPublicSmokeChecks({
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    targets: TARGETS,
    now: () => new Date('2026-09-22T12:00:00.000Z'),
    request: createRequester(responses),
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.releaseId, RELEASE_ID);
  assert.equal(result.api.live.release.id, RELEASE_ID);
  assert.equal(result.api.ready.checks.database, true);
  assert.equal(result.ui.health.artifactValidation.mainAsset, MAIN_ASSET);
  assert.equal(result.ui.assetManifest.mainAsset, MAIN_ASSET);
  assert.equal(result.ui.index.referencesMainAsset, true);
  assert.equal(result.ui.sourceMapProbe.publicSourceMapsDenied, true);
  assert.equal(result.companions.transaction.manifest.name, 'transaction-manifest');
  assert.equal(result.companions.transaction.manifest.manifestName, 'New Transaction');
  assert.equal(result.companions.counter.manifest.name, 'counter-manifest');
  assert.equal(result.companions.counter.manifest.manifestName, 'New Counter');
});

test('public smoke verifier fails closed when API release identity does not match', async () => {
  const responses = createFixtureResponses({
    releaseId: `omnilodge-r357-a1-${'123456789abc'}`,
  });

  await assert.rejects(
    runPublicSmokeChecks({
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      targets: TARGETS,
      request: createRequester(responses),
      retryWindowMs: 0,
    }),
    /API liveness release ID does not match/,
  );
});

test('public smoke verifier fails closed when the public UI does not serve the manifest asset', async () => {
  const responses = createFixtureResponses({
    indexBody: '<!doctype html><html><body><div id="root"></div></body></html>',
  });

  await assert.rejects(
    runPublicSmokeChecks({
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      targets: TARGETS,
      request: createRequester(responses),
      retryWindowMs: 0,
    }),
    /UI index does not reference the target main asset/,
  );
});

test('public smoke verifier fails closed when source maps are publicly exposed', async () => {
  const responses = createFixtureResponses({ sourceMapStatus: 200 });

  await assert.rejects(
    runPublicSmokeChecks({
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      targets: TARGETS,
      request: createRequester(responses),
      retryWindowMs: 0,
    }),
    /source-map probe returned HTTP 200/,
  );
});

test('public smoke verifier retries warm-up checks until the target release is visible', async () => {
  const responses = createFixtureResponses();
  const calls = new Map();
  const request = async ({ url }) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    if (url === `${TARGETS.applicationOrigin}/api/health/live` && calls.get(url) === 1) {
      return jsonResponse({
        status: 'ok',
        live: true,
        release: {
          id: `omnilodge-r357-a1-${'123456789abc'}`,
          gitSha: SOURCE_SHA,
          runtimeMode: 'primary',
        },
      });
    }
    const response = responses.get(url);
    if (!response) throw new Error(`Unexpected smoke URL: ${url}`);
    return response;
  };

  const result = await runPublicSmokeChecks({
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    targets: TARGETS,
    request,
    retryWindowMs: 1_000,
    retryIntervalMs: 0,
    wait: async () => {},
  });

  assert.equal(result.api.live.attempts, 2);
  assert.equal(result.api.live.release.id, RELEASE_ID);
});
