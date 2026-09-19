export const HOST_AUDIT_EVENT_SCHEMA_VERSION = 1;
export const HOST_REQUEST_NONCE_SCHEMA_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export const HOST_DEPLOY_RETENTION = Object.freeze({
  requestNonceRetentionMs: 30 * DAY_MS,
  finishedRequestRetentionMs: 30 * DAY_MS,
  maximumNonceRecords: 16_384,
  maximumDeploymentRecords: 4_096,
  auditRetentionMs: 90 * DAY_MS,
  auditMaximumSegmentAgeMs: DAY_MS,
  maximumAuditSegments: 32,
  maximumAuditSegmentBytes: 256 * 1024,
  maximumAuditLineBytes: 16 * 1024,
  maximumQueuedAuditAppends: 128,
});

export const HOST_DEPLOY_PATHS = Object.freeze({
  incomingRoot: '/opt/omnilodge/incoming',
  deployRoot: '/var/lib/omnilodge/deploy',
  requestsRoot: '/var/lib/omnilodge/deploy/requests',
  pendingRequests: '/var/lib/omnilodge/deploy/requests/pending',
  runningRequests: '/var/lib/omnilodge/deploy/requests/running',
  finishedRequests: '/var/lib/omnilodge/deploy/requests/finished',
  requestNonces: '/var/lib/omnilodge/deploy/requests/nonces',
  auditRoot: '/var/lib/omnilodge/deploy/audit',
  auditSegments: '/var/lib/omnilodge/deploy/audit/segments',
  lockFile: '/run/omnilodge/deploy.lock',
});

export const REQUEST_STATES = Object.freeze(['pending', 'running', 'finished']);

export const REQUEST_TRANSITIONS = Object.freeze({
  pending: 'running',
  running: 'finished',
});

export const HOST_AUDIT_EVENT_TYPES = Object.freeze([
  'request_admitted',
  'request_replayed',
  'request_running',
  'request_finished',
  'request_rejected',
  'request_recovered',
]);
