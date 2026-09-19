import assert from 'node:assert/strict';
import test from 'node:test';

import { createUiServerHealthHandler } from './health.js';

test('reports liveness, release, and public artifact validation details only', () => {
  const handler = createUiServerHealthHandler({
    release: 'release-abc123',
    startedAt: new Date('2026-09-14T10:00:00.000Z'),
    uptime: () => 42.8,
    artifactValidation: {
      status: 'valid',
      validatedAt: '2026-09-14T09:59:59.000Z',
      mainAsset: '/static/js/main.1234abcd.js',
      assetCount: 100,
      hashedAssetCount: 90,
      pwaManifestCount: 3,
      releaseSource: 'expected',
      buildPath: '/secret/server/path',
    },
  });
  const headers = new Map();
  let statusCode = null;
  let body = null;
  const response = {
    setHeader: (name, value) => headers.set(name, value),
    status: (value) => {
      statusCode = value;
      return response;
    },
    json: (value) => {
      body = value;
      return response;
    },
  };

  handler({}, response);

  assert.equal(statusCode, 200);
  assert.equal(headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(body, {
    status: 'ok',
    service: 'ui-server',
    release: 'release-abc123',
    startedAt: '2026-09-14T10:00:00.000Z',
    uptimeSeconds: 42,
    artifactValidation: {
      status: 'valid',
      validatedAt: '2026-09-14T09:59:59.000Z',
      mainAsset: '/static/js/main.1234abcd.js',
      assetCount: 100,
      hashedAssetCount: 90,
      pwaManifestCount: 3,
    },
  });
  assert.equal(JSON.stringify(body).includes('/secret/server/path'), false);
  assert.equal('releaseSource' in body.artifactValidation, false);
});
