import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runManagedOriginReadinessChecks,
} from './libexec/deploy/managed-origin-readiness-verifier.mjs';

const SOURCE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const RELEASE_ID = `omnilodge-r357-a1-${SOURCE_SHA.slice(0, 12)}`;
const TARGETS = Object.freeze({
  backendOrigin: 'http://127.0.0.1:3001',
  uiOrigin: 'https://127.0.0.1:443',
  hostHeader: 'omni-lodge.com',
  tlsServername: 'omni-lodge.com',
  rejectUnauthorized: false,
});
const BACKEND_ORIGIN = new URL(TARGETS.backendOrigin).origin;
const UI_ORIGIN = new URL(TARGETS.uiOrigin).origin;

const jsonResponse = (body, statusCode = 200) => Object.freeze({
  statusCode,
  headers: Object.freeze({ 'content-type': 'application/json; charset=utf-8' }),
  body: JSON.stringify(body),
});

const createFixtureResponses = ({
  releaseId = RELEASE_ID,
  sourceSha = SOURCE_SHA,
} = {}) => new Map([
  [`${BACKEND_ORIGIN}/api/health/ready`, jsonResponse({
    status: 'ok',
    ready: true,
    release: {
      id: releaseId,
      gitSha: sourceSha,
      runtimeMode: 'primary',
    },
    checks: {
      configuration: { ok: true },
      database: { ok: true },
    },
  })],
  [`${UI_ORIGIN}/healthz`, jsonResponse({
    status: 'ok',
    service: 'ui-server',
    release: releaseId,
    artifactValidation: {
      status: 'valid',
      mainAsset: '/static/js/main.1234abcd.js',
      assetCount: 12,
      hashedAssetCount: 9,
      pwaManifestCount: 3,
    },
  })],
  [`${UI_ORIGIN}/api/health/live`, jsonResponse({
    status: 'ok',
    live: true,
    release: {
      id: releaseId,
      gitSha: sourceSha,
      runtimeMode: 'primary',
    },
  })],
]);

const createRequester = (responses, seen = []) => async ({
  url,
  hostHeader,
  tlsServername,
  rejectUnauthorized,
}) => {
  seen.push({ url, hostHeader, tlsServername, rejectUnauthorized });
  const response = responses.get(url);
  if (!response) throw new Error(`Unexpected managed origin URL: ${url}`);
  return response;
};

test('managed origin verifier proves backend, UI, and UI API proxy readiness locally', async () => {
  const seen = [];
  const result = await runManagedOriginReadinessChecks({
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    targets: TARGETS,
    now: () => new Date('2026-09-22T12:00:00.000Z'),
    request: createRequester(createFixtureResponses(), seen),
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.releaseId, RELEASE_ID);
  assert.equal(result.backend.ready.release.id, RELEASE_ID);
  assert.equal(result.backend.ready.checks.database, true);
  assert.equal(result.ui.health.release, RELEASE_ID);
  assert.equal(result.ui.apiLive.release.gitSha, SOURCE_SHA);
  assert.deepEqual(
    seen.map((call) => [call.url, call.hostHeader, call.tlsServername, call.rejectUnauthorized]),
    [
      [`${TARGETS.backendOrigin}/api/health/ready`, TARGETS.hostHeader, TARGETS.tlsServername, false],
      [`${UI_ORIGIN}/healthz`, TARGETS.hostHeader, TARGETS.tlsServername, false],
      [`${UI_ORIGIN}/api/health/live`, TARGETS.hostHeader, TARGETS.tlsServername, false],
    ],
  );
});

test('managed origin verifier retries until the local origin exposes the target release', async () => {
  const responses = createFixtureResponses();
  const calls = new Map();
  const request = async ({ url }) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    if (url === `${UI_ORIGIN}/healthz` && calls.get(url) === 1) {
      return jsonResponse({
        status: 'ok',
        service: 'ui-server',
        release: `omnilodge-r357-a1-${'123456789abc'}`,
        artifactValidation: {
          status: 'valid',
          mainAsset: '/static/js/main.1234abcd.js',
        },
      });
    }
    const response = responses.get(url);
    if (!response) throw new Error(`Unexpected managed origin URL: ${url}`);
    return response;
  };

  const result = await runManagedOriginReadinessChecks({
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    targets: TARGETS,
    request,
    retryWindowMs: 1_000,
    retryIntervalMs: 0,
    wait: async () => {},
  });

  assert.equal(result.ui.health.attempts, 2);
  assert.equal(result.ui.health.release, RELEASE_ID);
});

test('managed origin verifier fails closed with endpoint attempts when readiness never arrives', async () => {
  await assert.rejects(
    runManagedOriginReadinessChecks({
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      targets: TARGETS,
      request: async ({ url }) => {
        if (url === `${TARGETS.backendOrigin}/api/health/ready`) {
          return jsonResponse({
            status: 'ok',
            ready: true,
            release: {
              id: `omnilodge-r357-a1-${'123456789abc'}`,
              gitSha: SOURCE_SHA,
              runtimeMode: 'primary',
            },
            checks: {
              configuration: { ok: true },
              database: { ok: true },
            },
          });
        }
        throw new Error(`Unexpected managed origin URL: ${url}`);
      },
      retryWindowMs: 0,
      wait: async () => {},
    }),
    (error) => {
      assert.match(error.message, /backend-direct-ready managed origin readiness/);
      assert.equal(error.managedOriginReadiness.name, 'backend-direct-ready');
      assert.equal(error.managedOriginReadiness.attempts.length, 1);
      assert.match(error.managedOriginReadiness.lastMessage, /release ID does not match/);
      return true;
    },
  );
});
