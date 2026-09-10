#!/usr/bin/env node

// This launcher deliberately depends only on Node built-ins. Static ESM imports
// in the application execute before app.ts can install process handlers, so a
// broken runtime dependency would otherwise be visible only in PM2 logs. A
// failed import is durably queued here and replayed by the API after it can
// start successfully again.
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const MAX_BOOTSTRAP_SPOOL_BYTES = 1024 * 1024;
const MAX_BOOTSTRAP_RECORD_BYTES = 64 * 1024;
const RELEASE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const JWT_RELEASE_PATTERN = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/i;
const FINANCIAL_RELEASE_PATTERN = /^(?:\d{13,34}|[A-Z]{2}\d{2}[A-Z0-9]{11,30})$/i;

const safeRead = (value, key) => {
  try {
    return value && value[key];
  } catch {
    return undefined;
  }
};

const sanitizeText = (value, maxLength) => {
  let text;
  try {
    text = typeof value === 'string' ? value : String(value ?? '');
  } catch {
    text = '[unreadable]';
  }
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/(\b(?:pass(?:word|code)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|cvv|cvc)\b\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1[redacted]')
    .replace(/([?&][^=&#\s]{1,100}=)[^&#\s)\]]*/g, '$1[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi, '[redacted-iban]')
    .replace(/\b(?:\d[ -]?){20,34}\b/g, '[redacted-bank-account]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-number]')
    .replace(/(?:\+\d|\b\d)(?:[\s().-]*\d){7,14}\b/g, '[redacted-phone]')
    .replace(/\b(amount|balance|salary|wage|compensation|reimbursement|payout|revenue|price|cost|subtotal|grand[_ -]?total)\s*[:=]\s*(?:PLN|EUR|USD|GBP|z\u0142|\u20ac|\$)?\s*-?\d[\d .,]*/gi, '$1=[redacted]')
    .replace(/(?:\b(?:PLN|EUR|USD|GBP|CHF)\b|z\u0142|\u20ac|\$)\s*-?\d[\d .,]*/gi, '[redacted-amount]')
    .replace(/\b-?\d[\d .,]*\s*(?:PLN|EUR|USD|GBP|CHF|z\u0142)(?![A-Za-z0-9])/gi, '[redacted-amount]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-id]')
    .replace(/\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g, '[redacted-id]')
    .slice(0, maxLength);
};

const sanitizeReleaseToken = (value) => {
  let candidate;
  try {
    candidate = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  } catch {
    return null;
  }
  if (!RELEASE_TOKEN_PATTERN.test(candidate)) return null;
  if (JWT_RELEASE_PATTERN.test(candidate) || FINANCIAL_RELEASE_PATTERN.test(candidate)) return null;
  return candidate;
};

const resolveSpoolPath = () => {
  const configured = String(process.env.ERROR_MONITORING_SPOOL_PATH ?? '').trim();
  return path.resolve(configured || path.join(process.cwd(), 'runtime', 'error-monitoring', 'failed-events.ndjson'));
};

const appendBootstrapFailure = (error, targetLabel) => {
  try {
    const spoolPath = resolveSpoolPath();
    const directory = path.dirname(spoolPath);
    const message = sanitizeText(
      safeRead(error, 'message') || safeRead(error, 'name') || error || 'Application module failed to load',
      2_000,
    );
    const errorName = sanitizeText(safeRead(error, 'name') || 'StartupImportError', 160);
    const stack = sanitizeText(safeRead(error, 'stack') || '', 30_000);
    const now = new Date().toISOString();
    const envelope = {
      version: 1,
      id: randomUUID(),
      queuedAt: now,
      event: {
        clientEventId: `server-bootstrap:${randomUUID()}`,
        source: 'process',
        kind: 'startup_import_failure',
        level: 'fatal',
        message,
        errorName,
        stack: stack || null,
        occurredAt: now,
        environment: sanitizeText(process.env.NODE_ENV || 'production', 50),
        release: sanitizeReleaseToken(process.env.APP_VERSION || process.env.GIT_COMMIT_SHA || ''),
        context: {
          bootstrapLauncher: true,
          target: sanitizeText(targetLabel, 240),
          pid: process.pid,
          nodeVersion: process.version,
        },
        occurrenceWeight: 1,
      },
    };
    const line = `${JSON.stringify(envelope)}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > MAX_BOOTSTRAP_RECORD_BYTES) return false;
    if (existsSync(spoolPath) && statSync(spoolPath).size + bytes > MAX_BOOTSTRAP_SPOOL_BYTES) {
      return false;
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      chmodSync(directory, 0o700);
    } catch {
      // Windows and restricted filesystems may not support POSIX permissions.
    }
    const descriptor = openSync(spoolPath, 'a', 0o600);
    try {
      writeSync(descriptor, line, undefined, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      chmodSync(spoolPath, 0o600);
    } catch {
      // The durable append already succeeded.
    }
    return true;
  } catch {
    return false;
  }
};

const targetArgument = process.argv[2] || 'dist/app.js';
const forwardedArguments = process.argv.slice(3);
const absoluteTarget = path.resolve(process.cwd(), targetArgument);
const distRoot = path.resolve(process.cwd(), 'dist');
const targetIsContained = absoluteTarget === distRoot || absoluteTarget.startsWith(`${distRoot}${path.sep}`);
const targetLabel = targetIsContained
  ? path.relative(process.cwd(), absoluteTarget).replace(/\\/g, '/')
  : 'invalid-target';

try {
  if (!targetIsContained || absoluteTarget === distRoot) {
    throw new Error('The monitored startup target must be a file inside the compiled dist directory.');
  }
  // Preserve the target program's normal argv contract (including --undo for
  // migration commands) instead of exposing this launcher as argv[1].
  process.argv = [process.argv[0], absoluteTarget, ...forwardedArguments];
  await import(pathToFileURL(absoluteTarget).href);
} catch (error) {
  const stored = appendBootstrapFailure(error, targetLabel);
  const safeMessage = sanitizeText(
    safeRead(error, 'message') || safeRead(error, 'name') || 'Application module failed to load',
    2_000,
  );
  try {
    process.stderr.write(
      `[startup-fatal] ${safeMessage}${stored ? ' (queued for error-monitoring replay)' : ' (monitoring spool unavailable)'}\n`,
    );
  } catch {
    // There is no safer output path left; preserve the non-zero exit below.
  }
  process.exit(1);
}
