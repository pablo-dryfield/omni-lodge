import {
  HOST_DEPLOY_PATHS,
  HOST_DEPLOY_RETENTION,
} from './constants.mjs';
import path from 'node:path';
import { createDurableFileOps } from './secure-filesystem.mjs';
import {
  createAuditEvent,
  validateAuditEvent,
} from './state-schema.mjs';
import { serializeCanonicalJsonLine } from './canonical-json.mjs';

const validatePositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid`);
  return value;
};

const validateOptions = ({
  auditPath,
  fileOps,
  clock,
  maximumLineBytes,
  maximumSegmentBytes,
  maximumSegmentAgeMs,
  auditRetentionMs,
  maximumAuditSegments,
}) => {
  if (typeof auditPath !== 'string' || auditPath.length === 0) {
    throw new Error('Audit log path is missing');
  }
  if (!fileOps || typeof fileOps.appendDurableLine !== 'function') {
    throw new Error('Audit log file operations are invalid');
  }
  for (const method of ['readSecureBuffer', 'linkNoReplace', 'unlinkVerified', 'listSecureDirectory']) {
    if (typeof fileOps[method] !== 'function') {
      throw new Error('Audit log file operations are invalid');
    }
  }
  if (typeof clock !== 'function') throw new Error('Audit log clock is invalid');
  const lineLimit = validatePositiveInteger(maximumLineBytes, 'Maximum audit line bytes');
  const segmentLimit = validatePositiveInteger(maximumSegmentBytes, 'Maximum audit segment bytes');
  if (segmentLimit < lineLimit) {
    throw new Error('Maximum audit segment bytes must cover one audit line');
  }
  return Object.freeze({
    auditPath,
    auditDirectory: path.posix.dirname(auditPath),
    auditStem: path.posix.basename(auditPath, '.ndjson'),
    fileOps,
    clock,
    maximumLineBytes: lineLimit,
    maximumSegmentBytes: segmentLimit,
    maximumSegmentAgeMs: validatePositiveInteger(maximumSegmentAgeMs, 'Maximum audit segment age'),
    auditRetentionMs: validatePositiveInteger(auditRetentionMs, 'Audit retention'),
    maximumAuditSegments: validatePositiveInteger(maximumAuditSegments, 'Maximum audit segments'),
  });
};

const isMissing = (error) => error?.code === 'ENOENT';
const isExists = (error) => error?.code === 'EEXIST';
const isAuditCapacityError = (error) => /Audit file exceeds its byte limit/.test(error?.message ?? '');

const filenameTimestamp = (date) => {
  const iso = date.toISOString();
  return iso
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.', '');
};

const segmentTimestampPattern = (stem) => new RegExp(
  `^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{8})T(\\d{4})(\\d{2})?(\\d{3})?Z(?:-(\\d{3}))?\\.ndjson$`,
);

const parseSegmentTimestamp = (name, stem) => {
  const match = segmentTimestampPattern(stem).exec(name);
  if (!match) return null;
  const [, datePart, hourMinute, second = '00', millisecond = '000'] = match;
  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6)) - 1;
  const day = Number(datePart.slice(6, 8));
  const hour = Number(hourMinute.slice(0, 2));
  const minute = Number(hourMinute.slice(2, 4));
  const timestamp = Date.UTC(year, month, day, hour, minute, Number(second), Number(millisecond));
  if (Number.isNaN(timestamp)) return null;
  return timestamp;
};

export const createHostAuditLog = ({
  auditPath = `${HOST_DEPLOY_PATHS.auditSegments}/events.ndjson`,
  fileOps = createDurableFileOps(),
  clock = () => new Date(),
  maximumLineBytes = HOST_DEPLOY_RETENTION.maximumAuditLineBytes,
  maximumSegmentBytes = HOST_DEPLOY_RETENTION.maximumAuditSegmentBytes,
  maximumSegmentAgeMs = HOST_DEPLOY_RETENTION.auditMaximumSegmentAgeMs,
  auditRetentionMs = HOST_DEPLOY_RETENTION.auditRetentionMs,
  maximumAuditSegments = HOST_DEPLOY_RETENTION.maximumAuditSegments,
} = {}) => {
  const options = validateOptions({
    auditPath,
    fileOps,
    clock,
    maximumLineBytes,
    maximumSegmentBytes,
    maximumSegmentAgeMs,
    auditRetentionMs,
    maximumAuditSegments,
  });
  let appendTail = Promise.resolve();

  const serializeEventLine = (event) => {
    const line = serializeCanonicalJsonLine(validateAuditEvent(event));
    if (line.length > options.maximumLineBytes) throw new Error('Audit event exceeds the line byte limit');
    return line;
  };

  const activeFileNeedsRotation = (active, lineLength, now) => {
    const size = Number(active.stat?.size ?? active.bytes.length);
    if (size + lineLength > options.maximumSegmentBytes) return true;
    const modifiedMs = Number(active.stat?.mtimeMs ?? active.stat?.birthtimeMs ?? NaN);
    return Number.isFinite(modifiedMs) && now.getTime() - modifiedMs >= options.maximumSegmentAgeMs;
  };

  const rotateActiveSegment = async ({ force = false, lineLength = 0 } = {}) => {
    let active;
    try {
      active = await options.fileOps.readSecureBuffer(options.auditPath, {
        maximumBytes: options.maximumSegmentBytes + options.maximumLineBytes,
      });
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
    const now = options.clock();
    if (!force && !activeFileNeedsRotation(active, lineLength, now)) return false;
    const base = `${options.auditStem}-${filenameTimestamp(now)}`;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const suffix = String(attempt).padStart(3, '0');
      const rotatedPath = path.posix.join(options.auditDirectory, `${base}-${suffix}.ndjson`);
      try {
        await options.fileOps.linkNoReplace(options.auditPath, rotatedPath);
        await options.fileOps.unlinkVerified(options.auditPath, active.stat);
        return true;
      } catch (error) {
        if (isExists(error)) continue;
        if (isMissing(error)) return false;
        throw error;
      }
    }
    throw new Error('Unable to allocate a unique audit segment path');
  };

  const pruneSegments = async () => {
    const now = options.clock();
    let names;
    try {
      names = await options.fileOps.listSecureDirectory(options.auditDirectory, {
        maximumEntries: Math.max(options.maximumAuditSegments * 32, 16_384),
      });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    const segments = names
      .map((name) => ({
        name,
        timestamp: parseSegmentTimestamp(name, options.auditStem),
      }))
      .filter((segment) => segment.timestamp !== null)
      .sort((left, right) => (
        right.timestamp - left.timestamp || right.name.localeCompare(left.name)
      ));
    const removals = [];
    for (const [index, segment] of segments.entries()) {
      if (now.getTime() - segment.timestamp > options.auditRetentionMs
          || index >= options.maximumAuditSegments) {
        removals.push(segment.name);
      }
    }
    for (const name of removals) {
      const segmentPath = path.posix.join(options.auditDirectory, name);
      try {
        const current = await options.fileOps.readSecureBuffer(segmentPath, {
          maximumBytes: options.maximumSegmentBytes + options.maximumLineBytes,
        });
        await options.fileOps.unlinkVerified(segmentPath, current.stat);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  };

  const append = async ({
    identity,
    transportKeyLabel,
    eventType,
    outcomeCode = null,
  }) => {
    const event = createAuditEvent({
      identity,
      clock: options.clock,
      transportKeyLabel,
      eventType,
      outcomeCode,
    });
    const line = serializeEventLine(event);
    const appendOperation = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await rotateActiveSegment({ lineLength: line.length });
        try {
          await options.fileOps.appendDurableLine(options.auditPath, line, {
            maximumBytes: options.maximumLineBytes,
            maximumFileBytes: options.maximumSegmentBytes,
          });
          await pruneSegments();
          return;
        } catch (error) {
          if (attempt === 0 && isAuditCapacityError(error)) {
            await rotateActiveSegment({ force: true });
            continue;
          }
          throw error;
        }
      }
      throw new Error('Audit append failed after rotation retry');
    };
    appendTail = appendTail.then(appendOperation, appendOperation);
    await appendTail;
    return event;
  };

  return Object.freeze({
    append,
  });
};
