import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  UiArtifactValidationError,
  validateUiArtifact,
} from './uiArtifactValidation.js';

const writeFile = (root, relativePath, contents) => {
  const destination = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
};

const createValidBuild = ({ release = null } = {}) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-ui-artifact-'));
  const buildPath = path.join(temporaryRoot, 'ui', 'build');
  fs.mkdirSync(buildPath, { recursive: true });

  const releaseMeta = release
    ? `<meta name="app-version" content="${release}">`
    : '';
  writeFile(
    buildPath,
    'index.html',
    `<!doctype html><html><head>${releaseMeta}<script src="/pwa-manifest-selector.js"></script><script defer src="/static/js/main.1234abcd.js"></script><link href="/static/css/main.8765dcba.css" rel="stylesheet"></head><body><div id="root"></div></body></html>`,
  );
  writeFile(buildPath, 'static/js/main.1234abcd.js', 'globalThis.__appLoaded = true;');
  writeFile(buildPath, 'static/js/42.abcdef12.chunk.js', 'globalThis.__lazyLoaded = true;');
  writeFile(buildPath, 'static/css/main.8765dcba.css', 'body { color: #111; }');
  writeFile(buildPath, 'icons/icon-192.png', 'icon');
  writeFile(buildPath, 'icons/shortcut-96.png', 'shortcut');
  writeFile(buildPath, 'screenshots/home-wide.png', 'screenshot');
  writeFile(buildPath, 'companion/icon-192.png', 'companion icon');
  writeFile(
    buildPath,
    'asset-manifest.json',
    JSON.stringify({
      ...(release ? { release } : {}),
      files: {
        'main.js': '/static/js/main.1234abcd.js',
        'main.css': '/static/css/main.8765dcba.css',
        'static/js/42.abcdef12.chunk.js': '/static/js/42.abcdef12.chunk.js',
      },
      entrypoints: [
        'static/css/main.8765dcba.css',
        'static/js/main.1234abcd.js',
      ],
    }),
  );
  writeFile(
    buildPath,
    'manifest.json',
    JSON.stringify({
      name: 'OmniLodge',
      short_name: 'OmniLodge',
      start_url: '/',
      display: 'standalone',
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      screenshots: [{ src: '/screenshots/home-wide.png', sizes: '1280x720' }],
      shortcuts: [{
        name: 'Shortcut',
        url: '/shortcut',
        icons: [{ src: '/icons/shortcut-96.png', sizes: '96x96' }],
      }],
    }),
  );
  writeFile(
    buildPath,
    'companion/app.webmanifest',
    JSON.stringify({
      name: 'Companion',
      start_url: '/companion',
      display: 'standalone',
      icons: [{ src: '/companion/icon-192.png', sizes: '192x192' }],
    }),
  );
  writeFile(
    buildPath,
    'pwa-manifest-selector.js',
    'const manifest = "/manifest.json"; const companion = "/companion/app.webmanifest";',
  );
  writeFile(
    buildPath,
    'service-worker.js',
    'self.addEventListener("install", () => {}); const precache = [{url:"/index.html"},{url:"/static/js/main.1234abcd.js"},{url:"/static/js/42.abcdef12.chunk.js"}];',
  );

  return {
    buildPath,
    cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
  };
};

const expectValidationFailure = (buildPath, pattern, options = {}) => {
  assert.throws(
    () => validateUiArtifact({ buildPath, ...options }),
    (error) => error instanceof UiArtifactValidationError && pattern.test(error.message),
  );
};

test('validates the complete UI and PWA artifact graph', () => {
  const fixture = createValidBuild({ release: 'release-abc123' });
  try {
    const result = validateUiArtifact({
      buildPath: fixture.buildPath,
      expectedRelease: 'release-abc123',
      validatedAt: new Date('2026-09-14T12:00:00.000Z'),
    });

    assert.deepEqual(result, {
      status: 'valid',
      validatedAt: '2026-09-14T12:00:00.000Z',
      release: 'release-abc123',
      releaseSource: 'expected',
      mainAsset: '/static/js/main.1234abcd.js',
      assetCount: 11,
      hashedAssetCount: 3,
      pwaManifestCount: 2,
    });
  } finally {
    fixture.cleanup();
  }
});

test('uses the main bundle hash as a migration-compatible release fallback', () => {
  const fixture = createValidBuild();
  try {
    const result = validateUiArtifact({ buildPath: fixture.buildPath });
    assert.equal(result.release, 'web-1234abcd');
    assert.equal(result.releaseSource, 'main-asset-hash');
  } finally {
    fixture.cleanup();
  }
});

test('fails on a missing or invalid application shell', () => {
  const fixture = createValidBuild();
  try {
    fs.rmSync(path.join(fixture.buildPath, 'index.html'));
    expectValidationFailure(fixture.buildPath, /index\.html is missing or unreadable/);
    writeFile(fixture.buildPath, 'index.html', '<html><body>not the app</body></html>');
    expectValidationFailure(fixture.buildPath, /not a valid OmniLodge application shell/);
  } finally {
    fixture.cleanup();
  }
});

test('fails on malformed asset manifests and missing lazy chunks', () => {
  const fixture = createValidBuild();
  try {
    writeFile(fixture.buildPath, 'asset-manifest.json', '{broken');
    expectValidationFailure(fixture.buildPath, /asset-manifest\.json contains invalid JSON/);
  } finally {
    fixture.cleanup();
  }

  const missingChunkFixture = createValidBuild();
  try {
    fs.rmSync(path.join(missingChunkFixture.buildPath, 'static/js/42.abcdef12.chunk.js'));
    expectValidationFailure(missingChunkFixture.buildPath, /42\.abcdef12\.chunk\.js.*missing or unreadable/);
  } finally {
    missingChunkFixture.cleanup();
  }
});

test('rejects unsafe artifact references before reading outside the build', () => {
  const fixture = createValidBuild();
  try {
    const manifestPath = path.join(fixture.buildPath, 'asset-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files.escape = '/../outside.12345678.js';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expectValidationFailure(fixture.buildPath, /not a safe build-relative path/);
  } finally {
    fixture.cleanup();
  }
});

test('fails when service-worker or PWA essentials are invalid', () => {
  const fixture = createValidBuild();
  try {
    fs.rmSync(path.join(fixture.buildPath, 'service-worker.js'));
    expectValidationFailure(fixture.buildPath, /service-worker\.js is missing or unreadable/);
  } finally {
    fixture.cleanup();
  }

  const missingIconFixture = createValidBuild();
  try {
    fs.rmSync(path.join(missingIconFixture.buildPath, 'icons/icon-192.png'));
    expectValidationFailure(missingIconFixture.buildPath, /manifest\.json icons\[0\]\.src is missing or unreadable/);
  } finally {
    missingIconFixture.cleanup();
  }

  const invalidWorkerFixture = createValidBuild();
  try {
    writeFile(invalidWorkerFixture.buildPath, 'service-worker.js', 'const ordinaryScript = true;');
    expectValidationFailure(invalidWorkerFixture.buildPath, /does not contain a service-worker event handler/);
  } finally {
    invalidWorkerFixture.cleanup();
  }

  const missingPrecacheFixture = createValidBuild();
  try {
    writeFile(
      missingPrecacheFixture.buildPath,
      'service-worker.js',
      'self.addEventListener("install", () => {}); const precache = [{url:"/static/js/missing.abcdef12.chunk.js"}];',
    );
    expectValidationFailure(
      missingPrecacheFixture.buildPath,
      /service-worker\.js precache reference is missing or unreadable/,
    );
  } finally {
    missingPrecacheFixture.cleanup();
  }

  const invalidSelectorFixture = createValidBuild();
  try {
    writeFile(invalidSelectorFixture.buildPath, 'pwa-manifest-selector.js', '(() => {');
    expectValidationFailure(
      invalidSelectorFixture.buildPath,
      /pwa-manifest-selector\.js contains invalid JavaScript/,
    );
  } finally {
    invalidSelectorFixture.cleanup();
  }
});

test('requires explicit artifact metadata when an expected release is configured', () => {
  const fixture = createValidBuild();
  try {
    expectValidationFailure(
      fixture.buildPath,
      /expected UI release metadata is missing/,
      { expectedRelease: 'release-abc123' },
    );
  } finally {
    fixture.cleanup();
  }
});

test('rejects release metadata that is inconsistent or not expected', () => {
  const fixture = createValidBuild({ release: 'release-one' });
  try {
    expectValidationFailure(
      fixture.buildPath,
      /does not match the expected release/,
      { expectedRelease: 'release-two' },
    );

    const indexPath = path.join(fixture.buildPath, 'index.html');
    fs.writeFileSync(
      indexPath,
      fs.readFileSync(indexPath, 'utf8').replace('release-one', 'release-other'),
    );
    expectValidationFailure(fixture.buildPath, /metadata sources are inconsistent/);
  } finally {
    fixture.cleanup();
  }
});

test('accepts the combined artifact release manifest as release metadata', () => {
  const fixture = createValidBuild();
  try {
    const releaseRoot = path.resolve(fixture.buildPath, '..', '..');
    fs.writeFileSync(
      path.join(releaseRoot, 'release-manifest.json'),
      JSON.stringify({ schemaVersion: 1, releaseId: 'release-combined' }),
    );
    const result = validateUiArtifact({
      buildPath: fixture.buildPath,
      expectedRelease: 'release-combined',
    });
    assert.equal(result.release, 'release-combined');
  } finally {
    fixture.cleanup();
  }
});

test('rejects inconsistent build-local and combined release manifests', () => {
  const fixture = createValidBuild();
  try {
    writeFile(
      fixture.buildPath,
      'release-metadata.json',
      JSON.stringify({ release: 'release-build' }),
    );
    const releaseRoot = path.resolve(fixture.buildPath, '..', '..');
    fs.writeFileSync(
      path.join(releaseRoot, 'release-manifest.json'),
      JSON.stringify({ schemaVersion: 1, releaseId: 'release-combined' }),
    );
    expectValidationFailure(fixture.buildPath, /metadata sources are inconsistent/);
  } finally {
    fixture.cleanup();
  }
});
