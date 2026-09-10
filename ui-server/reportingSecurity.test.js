import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBrowserReportUrl,
  resolvePublicReportingOrigin,
  UI_CONTENT_SECURITY_POLICY,
} from './reportingSecurity.js';

test('allows both base and versioned automatic Cloudflare Web Analytics scripts', () => {
  const directives = new Map(
    UI_CONTENT_SECURITY_POLICY.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );

  assert.deepEqual(directives.get('script-src'), [
    "'self'",
    'https://connect.facebook.net',
    'https://static.cloudflareinsights.com/beacon.min.js',
    'https://static.cloudflareinsights.com/beacon.min.js/',
  ]);
  assert.ok(!directives.get('script-src').includes('https://static.cloudflareinsights.com'));
  assert.ok(directives.get('connect-src').includes("'self'"));
  assert.ok(!directives.get('connect-src').includes('https://cloudflareinsights.com'));
});

test('uses a canonical configured origin and never a request Host header', () => {
  assert.equal(
    buildBrowserReportUrl({ configuredOrigin: 'https://app.example.test/path' }),
    'https://app.example.test/api/client-errors/browser-reports',
  );
  assert.equal(
    buildBrowserReportUrl({ configuredOrigin: 'https://attacker.example@evil.test' }),
    'https://omni-lodge.com/api/client-errors/browser-reports',
  );
  assert.equal(
    resolvePublicReportingOrigin({ configuredOrigin: 'javascript:alert(1)' }),
    'https://omni-lodge.com',
  );
});

test('permits plain HTTP only for loopback development', () => {
  assert.equal(
    resolvePublicReportingOrigin({ configuredOrigin: 'http://localhost:3005', environment: 'development' }),
    'http://localhost:3005',
  );
  assert.equal(
    resolvePublicReportingOrigin({ configuredOrigin: 'http://[::1]:3005', environment: 'development' }),
    'http://[::1]:3005',
  );
  assert.equal(
    resolvePublicReportingOrigin({ configuredOrigin: 'http://example.test', environment: 'development' }),
    'http://localhost:3005',
  );
  assert.equal(
    resolvePublicReportingOrigin({ configuredOrigin: 'http://localhost:3005', environment: 'production' }),
    'https://omni-lodge.com',
  );
});

test('defaults non-production reports to loopback instead of production', () => {
  assert.equal(
    resolvePublicReportingOrigin({ environment: 'development' }),
    'http://localhost:3005',
  );
  assert.equal(
    buildBrowserReportUrl({ environment: 'test', developmentOrigin: 'http://127.0.0.1:4567' }),
    'http://127.0.0.1:4567/api/client-errors/browser-reports',
  );
});
