import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  buildUiServerTelemetryHeaders,
  buildUiServerTelemetryRequest,
  isSecureTelemetryEndpoint,
  normalizeUiServerTelemetrySecret,
  stripInboundTelemetryCredential,
  UI_SERVER_TELEMETRY_SECRET_HEADER,
} from './telemetrySecurity.js';

const secret = 'a-long-independent-telemetry-secret-value';

test('requires an independent secret of at least 32 characters', () => {
  assert.equal(normalizeUiServerTelemetrySecret('too-short'), null);
  assert.equal(normalizeUiServerTelemetrySecret(secret), secret);
  assert.throws(() => buildUiServerTelemetryHeaders({
    endpoint: 'http://127.0.0.1:3001/api/client-errors/batch',
    secret: '',
  }));
});

test('sends the private header only over HTTPS or a loopback connection', () => {
  assert.equal(isSecureTelemetryEndpoint('http://127.0.0.1:3001/api/client-errors/batch'), true);
  assert.equal(isSecureTelemetryEndpoint('http://localhost:3001/api/client-errors/batch'), true);
  assert.equal(isSecureTelemetryEndpoint('http://[::1]:3001/api/client-errors/batch'), true);
  assert.equal(isSecureTelemetryEndpoint('https://api.example.test/client-errors'), true);
  assert.equal(isSecureTelemetryEndpoint('http://api.example.test/client-errors'), false);
  assert.equal(isSecureTelemetryEndpoint('https://user:password@api.example.test/client-errors'), false);

  const headers = buildUiServerTelemetryHeaders({
    endpoint: 'http://127.0.0.1:3001/api/client-errors/batch',
    secret,
  });
  assert.equal(headers[UI_SERVER_TELEMETRY_SECRET_HEADER], secret);
  assert.equal(headers['X-OmniLodge-Telemetry'], '1');
  assert.throws(() => buildUiServerTelemetryHeaders({
    endpoint: 'http://api.example.test/client-errors',
    secret,
  }));
});

test('rejects redirects so the private credential cannot be forwarded', () => {
  const request = buildUiServerTelemetryRequest({
    endpoint: 'http://127.0.0.1:3001/api/client-errors/batch',
    secret,
    body: '{"events":[]}',
  });

  assert.equal(request.redirect, 'error');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers[UI_SERVER_TELEMETRY_SECRET_HEADER], secret);
});

test('does not transmit the private credential to a redirect destination', async () => {
  let receivedSecret;
  const destination = http.createServer((request, response) => {
    receivedSecret = request.headers[UI_SERVER_TELEMETRY_SECRET_HEADER.toLowerCase()];
    response.end('ok');
  });
  await new Promise((resolve) => destination.listen(0, '127.0.0.1', resolve));
  const destinationPort = destination.address().port;

  const redirector = http.createServer((_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${destinationPort}/sink` });
    response.end();
  });
  await new Promise((resolve) => redirector.listen(0, '127.0.0.1', resolve));
  const redirectorPort = redirector.address().port;
  const endpoint = `http://127.0.0.1:${redirectorPort}/telemetry`;

  try {
    await assert.rejects(() => fetch(endpoint, buildUiServerTelemetryRequest({
      endpoint,
      secret,
      body: '{"events":[]}',
    })));
    assert.equal(receivedSecret, undefined);
  } finally {
    await Promise.all([
      new Promise((resolve) => redirector.close(resolve)),
      new Promise((resolve) => destination.close(resolve)),
    ]);
  }
});

test('strips the private credential from HTTP and WebSocket proxy requests', () => {
  const removed = [];
  stripInboundTelemetryCredential({ removeHeader: (name) => removed.push(name) });
  assert.deepEqual(removed, [UI_SERVER_TELEMETRY_SECRET_HEADER]);
  assert.doesNotThrow(() => stripInboundTelemetryCredential(new Proxy({}, {
    get: () => { throw new Error('malformed proxy request'); },
  })));
});
