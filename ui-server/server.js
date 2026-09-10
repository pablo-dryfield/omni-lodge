import express from 'express';
import https from 'https';
import fs from 'fs';
import path, { dirname }  from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  buildUiServerTelemetryRequest,
  isSecureTelemetryEndpoint,
  normalizeUiServerTelemetrySecret,
  stripInboundTelemetryCredential,
} from './telemetrySecurity.js';
import {
  pruneUiServerTelemetryQueueToBytes,
  safeUiServerRead,
  safeUiServerRequestPath,
  sanitizeUiServerContext,
  sanitizeUiServerCorrelationId,
  sanitizeUiServerText,
} from './telemetryPayload.js';
import {
  archiveSourceMaps,
  denyPublicSourceMaps,
} from './sourceMapArchive.js';
import {
  buildBrowserReportUrl,
  UI_CONTENT_SECURITY_POLICY,
} from './reportingSecurity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uiBuildPath = path.join(__dirname, '..', 'ui', 'build');
const uiIndexFile = path.join(uiBuildPath, 'index.html');
const uiServerPort = Number.parseInt(process.env.UI_SERVER_PORT ?? '3005', 10);
const uiServerListenPort = process.env.NODE_ENV === 'production' ? 443 : uiServerPort;
const uiServerTelemetryEndpoint =
  process.env.UI_SERVER_TELEMETRY_ENDPOINT
  ?? 'http://127.0.0.1:3001/api/client-errors/batch';
const uiServerTelemetrySecret = normalizeUiServerTelemetrySecret(
  process.env.UI_SERVER_TELEMETRY_SECRET,
);
const uiServerTelemetryEndpointIsSecure = isSecureTelemetryEndpoint(uiServerTelemetryEndpoint);
if (!uiServerTelemetrySecret) {
  logger.warn('[ui] Trusted error telemetry is paused: UI_SERVER_TELEMETRY_SECRET must contain at least 32 characters.');
} else if (!uiServerTelemetryEndpointIsSecure) {
  logger.warn('[ui] Trusted error telemetry is paused: its endpoint must use HTTPS or loopback HTTP and cannot contain credentials.');
}
const uiServerRelease =
  process.env.REACT_APP_BUILD_VERSION
  ?? process.env.REACT_APP_RELEASE
  ?? process.env.APP_VERSION
  ?? process.env.GIT_COMMIT_SHA
  ?? process.env.GIT_SHA
  ?? process.env.COMMIT_SHA
  ?? 'ui-server';
const resolveUiSourceMapRelease = () => {
  const configured = process.env.REACT_APP_RELEASE
    ?? process.env.REACT_APP_BUILD_VERSION
    ?? process.env.REACT_APP_GIT_SHA
    ?? process.env.REACT_APP_BUILD_ID;
  if (configured) return configured;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(uiBuildPath, 'asset-manifest.json'), 'utf8'),
    );
    const mainAsset = String(manifest?.files?.['main.js'] || '');
    const hash = mainAsset.match(/\/main\.([a-z0-9]+)\.js(?:$|\?)/i)?.[1];
    if (hash) return `web-${hash}`;
  } catch {
    // Build validation below reports a missing/unreadable manifest separately.
  }
  return uiServerRelease;
};
const uiSourceMapRelease = resolveUiSourceMapRelease();
const sourceMapArchiveRoot = process.env.ERROR_MONITORING_SOURCE_MAP_DIR
  ?? path.join(__dirname, '..', 'runtime', 'error-monitoring', 'source-maps');

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const UI_SERVER_TELEMETRY_MAX_QUEUE = 50;
const UI_SERVER_TELEMETRY_MAX_BATCH = 10;
const UI_SERVER_TELEMETRY_MAX_SPOOL_BYTES = 512_000;
const UI_SERVER_TELEMETRY_TIMEOUT_MS = 15_000;
const uiServerTelemetrySpoolPath =
  process.env.UI_SERVER_TELEMETRY_SPOOL_PATH
  ?? path.join(__dirname, '..', 'runtime', 'error-monitoring', `ui-server-errors-${uiServerListenPort}.json`);
const uiServerTelemetryQueue = [];
let uiServerTelemetrySending = false;
let uiServerTelemetryAttempts = 0;
let uiServerTelemetryTimer = null;

const isTelemetryRequest = (value) =>
  safeUiServerRequestPath(value).startsWith('/api/client-errors/');

const persistUiServerTelemetryQueue = () => {
  let temporaryPath;
  try {
    if (uiServerTelemetryQueue.length === 0) {
      if (fs.existsSync(uiServerTelemetrySpoolPath)) fs.unlinkSync(uiServerTelemetrySpoolPath);
      return true;
    }
    const { serialized } = pruneUiServerTelemetryQueueToBytes(
      uiServerTelemetryQueue,
      UI_SERVER_TELEMETRY_MAX_SPOOL_BYTES,
    );
    temporaryPath = `${uiServerTelemetrySpoolPath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(uiServerTelemetrySpoolPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, uiServerTelemetrySpoolPath);
    fs.chmodSync(uiServerTelemetrySpoolPath, 0o600);
    return true;
  } catch {
    // Reporting must never break the production UI server.
    try {
      if (temporaryPath && fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // A stale private temporary file is preferable to breaking the UI process.
    }
    return false;
  }
};

const restoreUiServerTelemetryQueue = () => {
  try {
    if (!fs.existsSync(uiServerTelemetrySpoolPath)) return;
    // Older builds measured JavaScript characters instead of UTF-8 bytes and
    // could write at most roughly four times the intended cap. Recover and
    // normalize those bounded legacy files instead of silently abandoning them.
    if (fs.statSync(uiServerTelemetrySpoolPath).size > UI_SERVER_TELEMETRY_MAX_SPOOL_BYTES * 4) {
      return;
    }
    const stored = JSON.parse(fs.readFileSync(uiServerTelemetrySpoolPath, 'utf8'));
    if (!Array.isArray(stored)) return;
    stored.slice(-UI_SERVER_TELEMETRY_MAX_QUEUE).forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return;
      const pathValue = safeUiServerRequestPath(candidate.route || candidate.pageUrl || '/');
      const type = ['exception', 'api_error', 'manual'].includes(candidate.type)
        ? candidate.type
        : 'exception';
      const sanitizedEventId = sanitizeUiServerCorrelationId(candidate.eventId);
      uiServerTelemetryQueue.push({
        eventId: typeof candidate.eventId === 'string'
          && sanitizedEventId === candidate.eventId
          && /^[A-Za-z0-9._:-]{1,200}$/.test(candidate.eventId)
          ? sanitizedEventId
          : randomUUID(),
        type,
        level: candidate.level === 'fatal'
          ? 'fatal'
          : candidate.level === 'warning'
            ? 'warning'
            : 'error',
        name: sanitizeUiServerText(candidate.name || 'UiServerError', 160),
        message: sanitizeUiServerText(candidate.message || 'UI server failure'),
        stack: candidate.stack ? sanitizeUiServerText(candidate.stack, 12_000) : undefined,
        occurredAt: typeof candidate.occurredAt === 'string'
          ? sanitizeUiServerText(candidate.occurredAt, 40)
          : new Date().toISOString(),
        pageUrl: pathValue,
        route: pathValue,
        release: typeof candidate.release === 'string'
          ? sanitizeUiServerCorrelationId(candidate.release)
          : sanitizeUiServerCorrelationId(uiServerRelease),
        environment: candidate.environment === 'development'
          || candidate.environment === 'test'
          || candidate.environment === 'staging'
          ? candidate.environment
          : 'production',
        requestId: typeof candidate.requestId === 'string'
          ? sanitizeUiServerCorrelationId(candidate.requestId)
          : undefined,
        http: candidate.http && typeof candidate.http === 'object'
          ? {
              method: sanitizeUiServerText(candidate.http.method, 20),
              url: safeUiServerRequestPath(candidate.http.url || pathValue),
              status: Number.isInteger(candidate.http.status) ? candidate.http.status : undefined,
              requestId: typeof candidate.http.requestId === 'string'
                ? sanitizeUiServerCorrelationId(candidate.http.requestId)
                : undefined,
            }
          : undefined,
        tags: { runtime: 'ui-server' },
        context: { runtime: 'ui-server', replayedFromDisk: true },
      });
    });
    persistUiServerTelemetryQueue();
  } catch {
    // Leave an unreadable spool untouched for manual diagnosis; continue serving UI.
  }
};

const scheduleUiServerTelemetry = (delayMs = 100) => {
  // Keep an existing retry/backoff deadline. Repeated proxy errors during an
  // outage must not continually reset it to an immediate retry.
  if (uiServerTelemetryTimer) return;
  uiServerTelemetryTimer = setTimeout(() => {
    uiServerTelemetryTimer = null;
    void flushUiServerTelemetry();
  }, delayMs);
  uiServerTelemetryTimer.unref?.();
};

const flushUiServerTelemetry = async () => {
  if (
    uiServerTelemetrySending
    || uiServerTelemetryQueue.length === 0
    || typeof globalThis.fetch !== 'function'
    // Without a securely configured shared secret, keep the durable queue for
    // a later correctly configured restart instead of accepting/dropping these
    // process events as anonymous browser telemetry.
    || !uiServerTelemetrySecret
    || !uiServerTelemetryEndpointIsSecure
  ) {
    return;
  }
  uiServerTelemetrySending = true;
  const batch = uiServerTelemetryQueue.slice(0, UI_SERVER_TELEMETRY_MAX_BATCH);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), UI_SERVER_TELEMETRY_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const request = buildUiServerTelemetryRequest({
      endpoint: uiServerTelemetryEndpoint,
      secret: uiServerTelemetrySecret,
      body: JSON.stringify({ events: batch }),
      signal: abortController.signal,
    });
    const response = await globalThis.fetch(uiServerTelemetryEndpoint, request);
    await response.body?.cancel?.();
    if (!response.ok) throw new Error(`Telemetry endpoint returned ${response.status}`);
    const confirmedIds = new Set(batch.map((event) => event.eventId));
    for (let index = uiServerTelemetryQueue.length - 1; index >= 0; index -= 1) {
      if (confirmedIds.has(uiServerTelemetryQueue[index].eventId)) {
        uiServerTelemetryQueue.splice(index, 1);
      }
    }
    persistUiServerTelemetryQueue();
    uiServerTelemetryAttempts = 0;
  } catch {
    // Never log reporter failures: that could recursively create more telemetry.
    uiServerTelemetryAttempts += 1;
  } finally {
    clearTimeout(timeout);
    uiServerTelemetrySending = false;
  }
  if (uiServerTelemetryQueue.length > 0) {
    scheduleUiServerTelemetry(
      Math.min(60_000, 1_000 * (2 ** Math.min(uiServerTelemetryAttempts, 6))),
    );
  }
};

const appendUiServerTelemetryEvent = (event) => {
  if (uiServerTelemetryQueue.length >= UI_SERVER_TELEMETRY_MAX_QUEUE) {
    // Preserve the most actionable process crashes during a noisy proxy outage.
    // Drop the oldest lower-severity sample first; a new non-fatal sample never
    // displaces a queue containing only fatal events.
    const replaceableIndex = uiServerTelemetryQueue.findIndex(
      (queued) => queued.level !== 'fatal',
    );
    if (replaceableIndex >= 0) {
      uiServerTelemetryQueue.splice(replaceableIndex, 1);
    } else if (event.level !== 'fatal') {
      return persistUiServerTelemetryQueue();
    } else {
      uiServerTelemetryQueue.shift();
    }
  }
  uiServerTelemetryQueue.push(event);
  const persisted = persistUiServerTelemetryQueue();
  try {
    scheduleUiServerTelemetry();
  } catch {
    // The event remains in memory and, when possible, in the private spool.
  }
  return persisted;
};

const enqueueUiServerError = (input = {}) => {
  try {
    const requestPath = safeUiServerRead(input, 'path');
    if (isTelemetryRequest(requestPath)) return true;
    const pathValue = safeUiServerRequestPath(requestPath);
    const rawType = safeUiServerRead(input, 'type');
    const rawLevel = safeUiServerRead(input, 'level');
    const rawName = safeUiServerRead(input, 'name');
    const rawMessage = safeUiServerRead(input, 'message');
    const rawStack = safeUiServerRead(input, 'stack');
    const rawMethod = safeUiServerRead(input, 'method');
    const rawStatus = safeUiServerRead(input, 'status');
    const rawRequestId = safeUiServerRead(input, 'requestId');
    const sanitizedContext = sanitizeUiServerContext(safeUiServerRead(input, 'context'));
    const event = {
      eventId: randomUUID(),
      type: ['exception', 'api_error', 'manual'].includes(rawType) ? rawType : 'exception',
      level: rawLevel === 'fatal' ? 'fatal' : rawLevel === 'warning' ? 'warning' : 'error',
      name: sanitizeUiServerText(rawName || 'UiServerError', 160) || 'UiServerError',
      message: sanitizeUiServerText(rawMessage || 'UI server failure'),
      stack: rawStack ? sanitizeUiServerText(rawStack, 12_000) : undefined,
      occurredAt: new Date().toISOString(),
      pageUrl: pathValue,
      route: pathValue,
      release: sanitizeUiServerCorrelationId(uiServerRelease) || 'ui-server',
      environment: ['production', 'development', 'test', 'staging'].includes(process.env.NODE_ENV)
        ? process.env.NODE_ENV
        : 'production',
      requestId: rawRequestId ? sanitizeUiServerCorrelationId(rawRequestId) : undefined,
      http: rawMethod || Number.isInteger(rawStatus)
        ? {
            method: rawMethod ? sanitizeUiServerText(rawMethod, 20) : undefined,
            url: pathValue,
            status: Number.isInteger(rawStatus) ? rawStatus : undefined,
            requestId: rawRequestId ? sanitizeUiServerCorrelationId(rawRequestId) : undefined,
          }
        : undefined,
      tags: { runtime: 'ui-server' },
      context: { ...sanitizedContext, runtime: 'ui-server' },
    };
    return appendUiServerTelemetryEvent(event);
  } catch {
    // Even a hostile thrown Proxy/toString must not defeat fatal persistence.
    try {
      return appendUiServerTelemetryEvent({
        eventId: randomUUID(),
        type: 'exception',
        level: 'fatal',
        name: 'UiServerTelemetryCaptureFailure',
        message: 'A UI server failure could not be inspected safely',
        occurredAt: new Date().toISOString(),
        pageUrl: '/',
        route: '/',
        release: 'ui-server',
        environment: 'production',
        tags: { runtime: 'ui-server' },
        context: { runtime: 'ui-server', source: 'capture-fallback' },
      });
    } catch {
      return false;
    }
  }
};

const reportUiServerRequestFailure = (error, req, status = 500, source = 'ui-server') => {
  const requestPath = safeUiServerRequestPath(
    safeUiServerRead(req, 'originalUrl') || safeUiServerRead(req, 'url') || '/',
  );
  if (isTelemetryRequest(requestPath)) return;
  const headers = safeUiServerRead(req, 'headers');
  enqueueUiServerError({
    type: 'api_error',
    name: safeUiServerRead(error, 'name') || 'UiServerRequestError',
    message: safeUiServerRead(error, 'message') || `UI server returned ${status}`,
    stack: safeUiServerRead(error, 'stack'),
    method: safeUiServerRead(req, 'method'),
    path: requestPath,
    status,
    requestId: safeUiServerRead(headers, 'x-request-id'),
    context: { source },
  });
};

const browserReportUrl = buildBrowserReportUrl({
  configuredOrigin: process.env.PUBLIC_APP_ORIGIN,
  environment: process.env.NODE_ENV || 'development',
  developmentOrigin: `http://localhost:${uiServerPort}`,
});

restoreUiServerTelemetryQueue();
if (uiServerTelemetryQueue.length > 0) scheduleUiServerTelemetry(250);

const setNoCacheHeaders = (res) => {
  Object.entries(NO_CACHE_HEADERS).forEach(([header, value]) => {
    res.setHeader(header, value);
  });
};

const validateUiBuildAssets = () => {
  try {
    const html = fs.readFileSync(uiIndexFile, 'utf8');
    const references = [...new Set(
      [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
        .map((match) => match[1].split(/[?#]/, 1)[0])
        .filter(Boolean),
    )];
    const missingAssets = references.filter((assetPath) => {
      const normalizedPath = assetPath.replace(/^\/+/, '');
      return !fs.existsSync(path.join(uiBuildPath, normalizedPath));
    });

    if (missingAssets.length > 0) {
      logger.error(`[ui] Missing assets referenced in index.html: ${missingAssets.join(', ')}`);
      enqueueUiServerError({
        type: 'manual',
        name: 'UiBuildAssetMissing',
        message: 'The UI build references one or more missing static assets',
        path: '/',
        context: { missingAssetCount: missingAssets.length },
      });
    }
  } catch (error) {
    logger.error('[ui] Unable to validate build asset references', error);
    enqueueUiServerError({
      type: 'exception',
      name: safeUiServerRead(error, 'name') || 'UiBuildValidationError',
      message: safeUiServerRead(error, 'message') || 'Unable to validate UI build assets',
      stack: safeUiServerRead(error, 'stack'),
      path: '/',
      context: { source: 'build-validation' },
    });
  }
};

const app = express();
app.set('trust proxy', 1);

app.use((req, res, next) => {
  // Keep the browser allowlist narrow while permitting Meta's official
  // Embedded Signup SDK and preserving OmniLodge's existing local previews.
  res.setHeader('Content-Security-Policy', UI_CONTENT_SECURITY_POLICY);
  res.setHeader('Reporting-Endpoints', `csp-endpoint="${browserReportUrl}"`);
  res.setHeader('Report-To', JSON.stringify({
    group: 'csp-endpoint',
    max_age: 10_886_400,
    endpoints: [{ url: browserReportUrl }],
  }));
  // Chromium's Network Error Logging can report failed top-level loads and
  // resource/network failures even when the JavaScript application never ran.
  res.setHeader('NEL', JSON.stringify({
    report_to: 'csp-endpoint',
    max_age: 604_800,
    include_subdomains: false,
    success_fraction: 0,
    failure_fraction: 1,
  }));
  next();
});

app.use(
  '/api',
  createProxyMiddleware({
    target: 'http://127.0.0.1:3001',
    changeOrigin: false,
    xfwd: true,
    ws: true,
    // Embedded Signup completes several bounded Meta calls before returning.
    proxyTimeout: 120000,
    pathRewrite: (path) => `/api${path}`,
    on: {
      proxyReq: (proxyReq) => {
        // Browsers must never be able to reach the API with the private
        // server-to-server trust header, even if its name or value leaks.
        stripInboundTelemetryCredential(proxyReq);
      },
      proxyReqWs: (proxyReq) => {
        stripInboundTelemetryCredential(proxyReq);
      },
      error: (error, req, res) => {
        reportUiServerRequestFailure(error, req, 502, 'api-proxy');
        if ('headersSent' in res && res.headersSent) {
          res.end?.();
          return;
        }
        if ('writeHead' in res) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end?.(JSON.stringify({ message: 'The application service is temporarily unavailable.' }));
      },
    },
  })
);

// Source maps contain the application's original source code. Keep them on the
// host for private symbolication, but never expose them through the public UI.
app.use(denyPublicSourceMaps);

// Serve static files from the 'build' directory
app.use(
  express.static(uiBuildPath, {
    index: false,
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath);

      if (filename.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }

      if (
        filename === 'index.html' ||
        filename === 'asset-manifest.json' ||
        filename === 'service-worker.js' ||
        filename === 'manifest.json' ||
        filename === 'early-error-monitoring.js' ||
        filename === 'pwa-manifest-selector.js' ||
        filename === 'install.html' ||
        filename.endsWith('.webmanifest')
      ) {
        setNoCacheHeaders(res);
        return;
      }

      if (/\.[a-f0-9]{8,}\./i.test(filename)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

// catch-all only for non-API routes
app.get(/^\/(?!api).*/, (req, res) => {
  if (path.extname(req.path)) {
    res.status(404).type('text/plain').send('Not Found');
    return;
  }

  setNoCacheHeaders(res);
  res.sendFile(uiIndexFile);
});

app.use((error, req, res, next) => {
  reportUiServerRequestFailure(error, req, 500, 'express');
  logger.error('[ui] Unhandled request error', error);
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).type('text/plain').send('Unable to load the application.');
});

let fatalUiServerErrorObserved = false;
process.on('uncaughtExceptionMonitor', (error, origin) => {
  fatalUiServerErrorObserved = enqueueUiServerError({
    type: 'exception',
    level: 'fatal',
    name: safeUiServerRead(error, 'name') || 'UiServerUncaughtException',
    message: safeUiServerRead(error, 'message') || 'Uncaught UI server exception',
    stack: safeUiServerRead(error, 'stack'),
    path: '/',
    context: {
      source: 'process',
      origin: sanitizeUiServerText(origin, 100),
    },
  });
  void flushUiServerTelemetry();
});

process.on('warning', (warning) => {
  enqueueUiServerError({
    type: 'exception',
    level: 'warning',
    name: safeUiServerRead(warning, 'name') || 'UiServerRuntimeWarning',
    message: safeUiServerRead(warning, 'message') || 'UI server runtime warning',
    stack: safeUiServerRead(warning, 'stack'),
    path: '/',
    context: { source: 'process-warning' },
  });
});

process.on('exit', (code) => {
  if (!code || fatalUiServerErrorObserved) return;
  // enqueueUiServerError persists synchronously before scheduling delivery, so
  // the abnormal exit survives even though no async work can run at this point.
  enqueueUiServerError({
    type: 'exception',
    level: 'fatal',
    name: 'UiServerAbnormalExit',
    message: `UI server exited with code ${code}`,
    path: '/',
    context: { source: 'process-exit', exitCode: code },
  });
});

process.on('beforeExit', () => {
  void flushUiServerTelemetry();
});

validateUiBuildAssets();
try {
  const archivedMaps = archiveSourceMaps({
    buildRoot: uiBuildPath,
    archiveRoot: sourceMapArchiveRoot,
    release: uiSourceMapRelease,
    maxReleases: process.env.ERROR_MONITORING_SOURCE_MAP_RELEASES,
  });
  if (archivedMaps.discovered > 0) {
    logger.info(
      `[ui] Private source maps ready for ${archivedMaps.release}: `
      + `${archivedMaps.discovered} found, ${archivedMaps.copied} copied, `
      + `${archivedMaps.prunedReleases} old releases pruned`,
    );
  }
} catch (error) {
  logger.error('[ui] Unable to archive private source maps', error);
  enqueueUiServerError({
    type: 'exception',
    name: safeUiServerRead(error, 'name') || 'UiSourceMapArchiveError',
    message: safeUiServerRead(error, 'message') || 'Unable to archive private source maps',
    stack: safeUiServerRead(error, 'stack'),
    path: '/',
    context: { source: 'source-map-archive' },
  });
}

if(process.env.NODE_ENV === 'production'){
  // Define the directory path where the SSL certificate files are located
  const sslDir = path.join(__dirname, '..', 'be', 'src','ssl');

  // Read SSL certificate and private key files
  const options = {
    key: fs.readFileSync(path.join(sslDir, 'cf-origin.key')), // Read the private key file
    cert: fs.readFileSync(path.join(sslDir, 'cf-origin.pem')), // Read the SSL certificate file
  };
  const server = https.createServer(options, app);
  server.listen(uiServerListenPort, '0.0.0.0', () => {
    logger.info(`Server is running on port ${uiServerListenPort}`);
});
}else{
  app.listen(uiServerListenPort, '0.0.0.0', () => {
    logger.info(`Server is running on port ${uiServerListenPort}`);
  });
}
