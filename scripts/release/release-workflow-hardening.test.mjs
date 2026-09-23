import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../../.github/workflows/release.yml', import.meta.url);
const workflow = fs.readFileSync(workflowPath, 'utf8');

const packageJobStart = workflow.indexOf('\n  package:');
const packageJob = packageJobStart === -1 ? '' : workflow.slice(packageJobStart);

test('release package job keeps artifact provenance attestation enabled', () => {
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
    /uses: actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8/,
    'Attestation action must stay pinned to the reviewed v4.2.2 commit',
  );
  assert.match(
    packageJob,
    /\n          subject-path: \|\n            \$\{\{ runner\.temp \}\}\/omnilodge-release\/\$\{\{ needs\.metadata\.outputs\.release_id \}\}\.tar\.gz\n            \$\{\{ runner\.temp \}\}\/omnilodge-release\/\$\{\{ needs\.metadata\.outputs\.release_id \}\}\.tar\.gz\.sha256\n/,
    'Attestation must cover the immutable release tarball and its detached checksum',
  );
});
