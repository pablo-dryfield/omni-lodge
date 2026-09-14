import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadAndValidateTlsCredentials,
  resolveExpectedUiRelease,
  resolveUiServerRuntimePaths,
} from './runtimeConfig.js';

test('keeps checkout-relative runtime path defaults', () => {
  const moduleDirectory = path.resolve('project/ui-server');
  const result = resolveUiServerRuntimePaths({
    env: {},
    moduleDirectory,
    cwd: path.resolve('working'),
  });

  assert.equal(result.buildPath, path.resolve(moduleDirectory, '../ui/build'));
  assert.equal(result.tlsKeyPath, path.resolve(moduleDirectory, '../be/src/ssl/cf-origin.key'));
  assert.equal(result.tlsCertPath, path.resolve(moduleDirectory, '../be/src/ssl/cf-origin.pem'));
});

test('resolves configured absolute and working-directory-relative paths', () => {
  const cwd = path.resolve('runtime-root');
  const result = resolveUiServerRuntimePaths({
    env: {
      UI_BUILD_PATH: 'current/ui/build',
      UI_TLS_KEY_PATH: path.resolve('persistent/tls/origin.key'),
      UI_TLS_CERT_PATH: 'persistent/tls/origin.pem',
    },
    moduleDirectory: path.resolve('project/ui-server'),
    cwd,
  });

  assert.equal(result.buildPath, path.resolve(cwd, 'current/ui/build'));
  assert.equal(result.tlsKeyPath, path.resolve('persistent/tls/origin.key'));
  assert.equal(result.tlsCertPath, path.resolve(cwd, 'persistent/tls/origin.pem'));
});

test('selects the expected release using explicit precedence', () => {
  assert.equal(resolveExpectedUiRelease({ APP_VERSION: ' app ', UI_EXPECTED_RELEASE: ' ui ' }), 'ui');
  assert.equal(resolveExpectedUiRelease({ APP_VERSION: ' app ', REACT_APP_GIT_SHA: ' git ' }), 'git');
  assert.equal(resolveExpectedUiRelease({ APP_VERSION: ' app ' }), 'app');
  assert.equal(resolveExpectedUiRelease({}), null);
});

test('fails before startup when TLS files are missing, empty, or invalid', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-ui-tls-'));
  const keyPath = path.join(temporaryRoot, 'origin.key');
  const certPath = path.join(temporaryRoot, 'origin.pem');
  try {
    assert.throws(
      () => loadAndValidateTlsCredentials({ keyPath, certPath }),
      /private key is missing or unreadable/,
    );

    fs.writeFileSync(keyPath, 'not a key');
    fs.writeFileSync(certPath, 'not a certificate');
    assert.throws(
      () => loadAndValidateTlsCredentials({ keyPath, certPath }),
      /TLS credentials are invalid/,
    );

    fs.writeFileSync(keyPath, '');
    assert.throws(
      () => loadAndValidateTlsCredentials({ keyPath, certPath }),
      /private key is missing or unreadable: file is empty/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
