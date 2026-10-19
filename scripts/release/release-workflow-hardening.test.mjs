import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../../.github/workflows/release.yml', import.meta.url);
const workflow = fs.readFileSync(workflowPath, 'utf8');

const packageJobStart = workflow.indexOf('\n  package:');
const packageJob = packageJobStart === -1 ? '' : workflow.slice(packageJobStart);
const deployWorkflow = fs.readFileSync(
  new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const submitJobStart = deployWorkflow.indexOf('\n  submit_request:');
const prepareJob = deployWorkflow.slice(0, submitJobStart);
const submitJob = deployWorkflow.slice(submitJobStart);

test('production queues carry trusted release inputs, never an expiring host request', () => {
  assert.ok(submitJobStart > -1);
  assert.match(prepareJob, /node scripts\/deploy\/github-release-evidence\.mjs/);
  assert.match(prepareJob, /gh api "repos\/\$GITHUB_REPOSITORY\/actions\/artifacts\/\$ARTIFACT_ID\/zip"/);
  assert.match(prepareJob, /steps\.request\.outputs\.evidence_path/);
  assert.match(prepareJob, /steps\.request\.outputs\.artifact_zip_path/);
  assert.doesNotMatch(prepareJob, /create-host-v2-request\.mjs|requested_at_utc|randomUUID|host-v2-request\.bin/);
  assert.match(submitJob, /environment: production/);
});

test('production creates a fresh host identity after SSH setup and immediately before submission', () => {
  const sshSetup = submitJob.indexOf('- name: Prepare pinned SSH transport');
  const createAndSubmit = submitJob.indexOf('- name: Create and submit fresh host request');
  const poll = submitJob.indexOf('- name: Poll host request status');
  assert.ok(sshSetup > -1 && sshSetup < createAndSubmit && createAndSubmit < poll);
  const step = submitJob.slice(createAndSubmit, poll);
  const timestamp = step.indexOf('requested_at_utc="$(date -u');
  const create = step.indexOf('node scripts/deploy/create-host-v2-request.mjs');
  const submit = step.indexOf('node scripts/deploy/submit-host-v2-request.mjs');
  assert.ok(timestamp > -1 && timestamp < create && create < submit);
  assert.match(step, /randomUUID\(\)/);
  assert.match(step, /set -euo pipefail/);
  assert.match(step, /--artifact-zip "\$REQUEST_DIR\/github-artifact\.zip"/);
  assert.match(step, /--evidence-json "\$REQUEST_DIR\/release-evidence\.json"/);
  assert.match(step, /--request-id "\$request_id"/);
  assert.match(step, /--requested-at-utc "\$requested_at_utc"/);
  assert.match(step, /OPERATION: \$\{\{ needs\.prepare_request\.outputs\.operation \}\}/);
  assert.match(step, /TRIGGER: \$\{\{ needs\.prepare_request\.outputs\.trigger \}\}/);
  // Submission must stay in the same run block: no new queue/approval boundary.
  assert.doesNotMatch(step.slice(create, submit), /\n      - name:|\n    runs-on:|\n    environment:/);
});

test('production retains the actual submitted identity and host rejection response as audit evidence', () => {
  const upload = submitJob.slice(submitJob.indexOf('- name: Upload host response evidence'));
  assert.match(upload, /if: always\(\)/);
  for (const filename of ['host-v2-request-identity.json', 'host-v2-request-result.json', 'host-v2-submit-result.json']) {
    assert.ok(upload.includes(`/production-deploy-request/${filename}`), `${filename} must be retained`);
  }
  assert.match(upload, /retention-days: 3/);
});

test('release package job keeps artifact provenance attestation enabled when GitHub supports it', () => {
  assert.notEqual(packageJobStart, -1, 'Release workflow must contain the package job');

  assert.match(
    packageJob,
    /\n    permissions:\n(?:      [a-z-]+: (?:read|write)\n)+    steps:\n/,
    'Package job must declare explicit scoped permissions',
  );
  for (const permission of [
    'actions: read',
    'attestations: write',
    'contents: read',
    'id-token: write',
  ]) {
    assert.match(packageJob, new RegExp(`\\n      ${permission}\\n`), `Missing package permission: ${permission}`);
  }

  const attestStepIndex = packageJob.indexOf('- name: Attest immutable release artifact provenance');
  const uploadStepIndex = packageJob.indexOf('- name: Upload immutable release artifact');
  assert.ok(attestStepIndex > -1, 'Release workflow must attest the final release artifact');
  assert.ok(uploadStepIndex > -1, 'Release workflow must upload the final release artifact');
  assert.ok(attestStepIndex < uploadStepIndex, 'Release artifact must be attested before upload');

  assert.match(
    packageJob,
    /\n      - name: Attest immutable release artifact provenance\n        if: \$\{\{ !github\.event\.repository\.private \}\}\n/,
    'Stored GitHub attestations must be skipped only for private repositories that do not support them',
  );
  assert.match(
    packageJob,
    /uses: actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8/,
    'Attestation action must stay pinned to the reviewed v4.2.2 commit',
  );
  assert.match(
    packageJob,
    /\n          subject-path: \|\n            \$\{\{ runner\.temp \}\}\/omnilodge-release\/\$\{\{ needs\.metadata\.outputs\.release_id \}\}\.tar\.gz\n            \$\{\{ runner\.temp \}\}\/omnilodge-release\/\$\{\{ needs\.metadata\.outputs\.release_id \}\}\.tar\.gz\.sha256\n/,
    'Attestation must cover the immutable release tarball and its detached checksum',
  );
  assert.match(
    packageJob,
    /\n      - name: Report private repository attestation skip\n        if: \$\{\{ github\.event\.repository\.private \}\}\n/,
    'Private repositories must report why stored provenance attestation was skipped',
  );
});
