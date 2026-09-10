import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  archiveSourceMaps,
  denyPublicSourceMaps,
  isSourceMapRequest,
  normalizeSourceMapRelease,
} from './sourceMapArchive.js';

test('identifies encoded and ordinary public source-map requests', () => {
  assert.equal(isSourceMapRequest('/static/js/main.abc.js.map'), true);
  assert.equal(isSourceMapRequest('/static/js/main.js%2Emap?download=1'), true);
  assert.equal(isSourceMapRequest('/static/js/main.js%25252Emap'), true);
  assert.equal(isSourceMapRequest('/static/js/main.abc.js'), false);
});

test('never permits a release name to collapse onto the archive root', () => {
  assert.equal(normalizeSourceMapRelease('.'), 'unversioned');
  assert.equal(normalizeSourceMapRelease('..'), 'unversioned');
});

test('source-map middleware returns a non-cacheable 404 before static serving', () => {
  const headers = new Map();
  let nextCalled = false;
  let statusCode = 0;
  let body = '';
  const response = {
    setHeader: (key, value) => headers.set(key, value),
    status: (value) => { statusCode = value; return response; },
    type: () => response,
    send: (value) => { body = value; return response; },
  };

  denyPublicSourceMaps(
    { path: '/static/js/main.secret.js.map' },
    response,
    () => { nextCalled = true; },
  );

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 404);
  assert.equal(body, 'Not Found');
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('archives source maps in a private release directory without rewriting matches', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-maps-'));
  const buildRoot = path.join(temporaryRoot, 'build');
  const archiveRoot = path.join(temporaryRoot, 'private');
  try {
    fs.mkdirSync(path.join(buildRoot, 'static', 'js'), { recursive: true });
    fs.writeFileSync(path.join(buildRoot, 'static', 'js', 'main.abc.js.map'), '{"version":3}');
    fs.writeFileSync(path.join(buildRoot, 'static', 'js', 'main.abc.js'), 'code');

    const first = archiveSourceMaps({ buildRoot, archiveRoot, release: '../web abc' });
    const second = archiveSourceMaps({ buildRoot, archiveRoot, release: '../web abc' });

    assert.equal(first.release, normalizeSourceMapRelease('../web abc'));
    assert.equal(first.discovered, 1);
    assert.equal(first.copied, 1);
    assert.equal(second.copied, 0);
    assert.equal(
      fs.readFileSync(path.join(archiveRoot, first.release, 'static', 'js', 'main.abc.js.map'), 'utf8'),
      '{"version":3}',
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('replaces a stale same-size map by content and verifies the private copy', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-map-refresh-'));
  const buildRoot = path.join(temporaryRoot, 'build');
  const archiveRoot = path.join(temporaryRoot, 'private');
  try {
    const sourcePath = path.join(buildRoot, 'static', 'js', 'main.same.js.map');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, '{"version":3,"x":"a"}');
    const first = archiveSourceMaps({ buildRoot, archiveRoot, release: 'release-same' });
    fs.writeFileSync(sourcePath, '{"version":3,"x":"b"}');
    const second = archiveSourceMaps({ buildRoot, archiveRoot, release: 'release-same' });

    assert.equal(first.copied, 1);
    assert.equal(second.copied, 1);
    assert.equal(
      fs.readFileSync(path.join(archiveRoot, 'release-same', 'static', 'js', 'main.same.js.map'), 'utf8'),
      '{"version":3,"x":"b"}',
    );
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), '{"version":3,"x":"b"}');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects an archive path nested in the publicly served build', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-map-path-'));
  const buildRoot = path.join(temporaryRoot, 'build');
  try {
    fs.mkdirSync(buildRoot, { recursive: true });
    assert.throws(
      () => archiveSourceMaps({
        buildRoot,
        archiveRoot: path.join(buildRoot, 'private-maps'),
        release: 'release-1',
      }),
      /must be separate/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('keeps the source-map archive bounded by release count', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-map-retention-'));
  const buildRoot = path.join(temporaryRoot, 'build');
  const archiveRoot = path.join(temporaryRoot, 'private');
  try {
    fs.mkdirSync(path.join(buildRoot, 'static', 'js'), { recursive: true });
    fs.writeFileSync(path.join(buildRoot, 'static', 'js', 'main.abc.js.map'), '{"version":3}');
    archiveSourceMaps({ buildRoot, archiveRoot, release: 'release-1', maxReleases: 2 });
    archiveSourceMaps({ buildRoot, archiveRoot, release: 'release-2', maxReleases: 2 });
    const third = archiveSourceMaps({ buildRoot, archiveRoot, release: 'release-3', maxReleases: 2 });

    assert.equal(third.prunedReleases, 1);
    assert.deepEqual(fs.readdirSync(archiveRoot).sort(), ['release-2', 'release-3']);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
