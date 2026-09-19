import {
  selectDeploymentAuthorization,
  validateReleaseOperation,
} from '../github-release-evidence.mjs';
import {
  HOST_POLICY_SCHEMA_VERSION,
  parseCanonicalHostJson,
  serializeCanonicalHostJson,
  validateHostRequestIdentity,
} from './protocol.mjs';
import { validateHostV2RequestIdentity } from './protocol-v2.mjs';

export const MAX_HOST_POLICY_BYTES = 1024;

const DEPLOYMENT_MODES = new Set(['disabled', 'manual', 'automatic']);

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

export const validateHostDeployPolicy = (rawPolicy) => {
  invariant(isPlainObject(rawPolicy), 'Host deploy policy must be a JSON object');
  const keys = Object.keys(rawPolicy);
  invariant(
    keys.length === 2
      && keys[0] === 'schemaVersion'
      && keys[1] === 'deploymentMode',
    'Host deploy policy schema is not canonical',
  );
  invariant(
    rawPolicy.schemaVersion === HOST_POLICY_SCHEMA_VERSION,
    'Host deploy policy schema version is unsupported',
  );
  invariant(
    typeof rawPolicy.deploymentMode === 'string'
      && DEPLOYMENT_MODES.has(rawPolicy.deploymentMode),
    'Host deploy policy mode is invalid',
  );
  return Object.freeze({
    schemaVersion: HOST_POLICY_SCHEMA_VERSION,
    deploymentMode: rawPolicy.deploymentMode,
  });
};

export const parseCanonicalHostDeployPolicyBytes = (bytes) => validateHostDeployPolicy(
  parseCanonicalHostJson(bytes, {
    label: 'Host deploy policy',
    maximumBytes: MAX_HOST_POLICY_BYTES,
  }),
);

export const serializeCanonicalHostDeployPolicy = (policy) => serializeCanonicalHostJson(
  validateHostDeployPolicy(policy),
);

export const evaluateHostDeployPolicy = ({ policy, requestIdentity }) => {
  const validatedPolicy = validateHostDeployPolicy(policy);
  const identity = validateHostRequestIdentity(requestIdentity);

  // This decision is deliberately re-derived from the root-owned host policy.
  // The activationAuthorization object carried in release evidence is audit
  // evidence from GitHub, not server authorization.
  validateReleaseOperation({
    configuredMode: validatedPolicy.deploymentMode,
    trigger: identity.trigger,
    operation: identity.operation,
  });

  const authorization = identity.operation === 'deploy'
    ? selectDeploymentAuthorization({
      configuredMode: validatedPolicy.deploymentMode,
      trigger: identity.trigger,
    })
    : {
      authorized: true,
      mode: validatedPolicy.deploymentMode,
      trigger: identity.trigger,
      reason: 'non_activation_operation',
    };

  return Object.freeze({
    requestId: identity.requestId,
    releaseId: identity.releaseId,
    sourceSha: identity.sourceSha,
    operation: identity.operation,
    trigger: identity.trigger,
    auditSha256: identity.auditSha256,
    evidenceSha256: identity.evidenceSha256,
    artifactZipSha256: identity.artifactZipSha256,
    deploymentMode: validatedPolicy.deploymentMode,
    authorized: authorization.authorized,
    reason: authorization.reason,
  });
};

export const evaluateHostV2DeployPolicy = ({ policy, requestIdentity }) => {
  const validatedPolicy = validateHostDeployPolicy(policy);
  const identity = validateHostV2RequestIdentity(requestIdentity);

  let authorized;
  let reason;
  if (identity.kind === 'forward_submit') {
    // Forward activation remains governed by the independent root-owned mode.
    // Evidence authorization is an audit assertion and never replaces this
    // decision. Stage/dry-run retain the v1 manual-only rules.
    validateReleaseOperation({
      configuredMode: validatedPolicy.deploymentMode,
      trigger: identity.trigger,
      operation: identity.operation,
    });
    if (identity.operation === 'deploy') {
      const decision = selectDeploymentAuthorization({
        configuredMode: validatedPolicy.deploymentMode,
        trigger: identity.trigger,
      });
      authorized = decision.authorized;
      reason = decision.reason;
    } else {
      authorized = true;
      reason = 'non_activation_operation';
    }
  } else if (identity.kind === 'rollback_submit') {
    // A production freeze must stop forward releases without disabling the
    // operator's escape hatch. Rollback is manual-only in the request schema
    // and is deliberately independent of the forward deployment mode.
    authorized = true;
    reason = 'manual_rollback_allowed_during_forward_freeze';
  } else {
    authorized = true;
    reason = 'status_query';
  }

  return Object.freeze({
    ...identity,
    deploymentMode: validatedPolicy.deploymentMode,
    authorized,
    reason,
  });
};
