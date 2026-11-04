import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { installSystemIngress } from './bin/system-ingress-guard.mjs';

test('reserved origin never reaches a release SPA, including an unavailable broker and the first WebSocket', {timeout:15000}, async () => {
  let appRequests = 0, received; const upgraded = new Set();
  const upstream = http.createServer((req, res) => { received = req.headers; res.end('isolated console'); });
  upstream.on('upgrade', (_req, socket) => { upgraded.add(socket); socket.once('close',()=>upgraded.delete(socket)); socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); socket.on('data', (bytes) => socket.write(bytes)); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  installSystemIngress({ hostname: 'system.test', port: upstream.address().port });
  const legacyApp = http.createServer((_req, res) => { appRequests++; res.end('<script src="third-party.js"></script>'); });
  legacyApp.on('upgrade', () => { throw new Error('Release upgrade handler must never receive console traffic'); });
  legacyApp.listen(0, '127.0.0.1'); await once(legacyApp, 'listening');
  const request = (host, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: legacyApp.address().port, headers: { host, ...headers } }, (res) => { let body = ''; res.on('data', (bytes) => { body += bytes; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers })); }).on('error', reject);
  });
  try {
    const socket = net.connect(legacyApp.address().port, '127.0.0.1'); await once(socket, 'connect');
    socket.write('GET /management/stream HTTP/1.1\r\nHost: system.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    assert.match(String((await once(socket, 'data', {signal:AbortSignal.timeout(4000)}))[0]), /101 Switching Protocols/);
    socket.write('bounded frame'); assert.equal(String((await once(socket, 'data', {signal:AbortSignal.timeout(4000)}))[0]), 'bounded frame'); socket.destroy();
    const consoleResponse = await request('system.test', { authorization: 'Bearer MAIN_APP_SECRET', 'x-omnilodge-telemetry-token': 'SECRET', cookie: 'app=PRIVATE; __Host-omnilodge-management=console-only' });
    assert.equal(consoleResponse.body, 'isolated console'); assert.equal(received.authorization, undefined); assert.equal(received['x-omnilodge-telemetry-token'], undefined); assert.equal(received.cookie, '__Host-omnilodge-management=console-only');
    assert.equal((await request('main.test')).status, 200); assert.equal(appRequests, 1);
    for(const socket of upgraded)socket.destroy(); upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve));
    const unavailable = await request('system.test.'); assert.equal(unavailable.status, 503); assert.equal(unavailable.headers['x-omnilodge-system-ingress'], 'v1'); assert.equal(appRequests, 1); assert.doesNotMatch(unavailable.body, /script/);
  } finally { for(const socket of upgraded)socket.destroy(); upstream.closeAllConnections(); upstream.close(); legacyApp.closeAllConnections(); await new Promise((resolve) => legacyApp.close(resolve)); }
});
