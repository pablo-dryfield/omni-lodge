import {
  HOST_DEPLOY_PATHS,
  HOST_DEPLOY_RETENTION,
} from './constants.mjs';
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
}) => {
  if (typeof auditPath !== 'string' || auditPath.length === 0) {
    throw new Error('Audit log path is missing');
  }
  if (!fileOps || typeof fileOps.appendDurableLine !== 'function') {
    throw new Error('Audit log file operations are invalid');
  }
  if (typeof clock !== 'function') throw new Error('Audit log clock is invalid');
  return Object.freeze({
    auditPath,
    fileOps,
    clock,
    maximumLineBytes: validatePositiveInteger(maximumLineBytes, 'Maximum audit line bytes'),
  });
};

export const createHostAuditLog = ({
  auditPath = `${HOST_DEPLOY_PATHS.auditSegments}/events.ndjson`,
  fileOps = createDurableFileOps(),
  clock = () => new Date(),
  maximumLineBytes = HOST_DEPLOY_RETENTION.maximumAuditLineBytes,
} = {}) => {
  const options = validateOptions({
    auditPath,
    fileOps,
    clock,
    maximumLineBytes,
  });
  let appendTail = Promise.resolve();

  const serializeEventLine = (event) => {
    const line = serializeCanonicalJsonLine(validateAuditEvent(event));
    if (line.length > options.maximumLineBytes) throw new Error('Audit event exceeds the line byte limit');
    return line;
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
    const appendOperation = () => options.fileOps.appendDurableLine(options.auditPath, line);
    appendTail = appendTail.then(appendOperation, appendOperation);
    await appendTail;
    return event;
  };

  return Object.freeze({
    append,
  });
};
