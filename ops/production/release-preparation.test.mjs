import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CANONICAL_RELEASE_REF,
  CANONICAL_REPOSITORY,
  CANONICAL_WORKFLOW_PATH,
  REQUIRED_PAYLOAD_FILES,
  serializeReleaseManifest,
} from '../../scripts/release/lib.mjs';
import {
  PRODUCTION_RELEASE_LAYOUT,
  assertReleaseSnapshotUnchanged,
  assertSufficientDependencyCapacity,
  calculateDependencyCapacity,
  createReleasePreparationPlan,
  inspectDependencyPublicationState,
  publishDependencyLayer,
  validatePreparedReleaseLinks,
} from './libexec/deploy/release-preparation.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceSha = 'a'.repeat(40);
const releaseId = `omnilodge-r12345-a2-${sourceSha.slice(0, 12)}`;

const mkdir = (directory) => mkdirSync(directory, { recursive: true, mode: 0o755 });

const writeRelative = (root, relativePath, bytes) => {
  const destination = path.join(root, ...relativePath.split('/'));
  mkdir(path.dirname(destination));
  writeFileSync(destination, bytes, { mode: 0o644 });
};

const buildManifest = (payload) => {
  const files = [...payload.entries()]
    .map(([filePath, data]) => ({ path: filePath, size: data.length, sha256: sha256(data) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    releaseId,
    sourceSha,
    builtAtUtc: '2026-09-16T12:00:00.000Z',
    toolchain: { node: '22.23.2', npm: '10.9.8' },
    lockfiles: {
      'be/package-lock.json': sha256(payload.get('be/package-lock.json')),
      'ui/package-lock.json': 'b'.repeat(64),
      'ui-server/package-lock.json': sha256(payload.get('ui-server/package-lock.json')),
    },
    mainUiAsset: 'ui/build/static/js/main.fixture.js',
    fileCount: files.length,
    files,
    workflow: {
      repository: CANONICAL_REPOSITORY,
      canonicalRepository: CANONICAL_REPOSITORY,
      workflowName: 'Release',
      workflowPath: CANONICAL_WORKFLOW_PATH,
      canonicalWorkflowPath: CANONICAL_WORKFLOW_PATH,
      event: 'push',
      ref: CANONICAL_RELEASE_REF,
      headSha: sourceSha,
      runId: '12345',
      runAttempt: 2,
      runNumber: '77',
      actor: 'release-operator',
      artifactName: releaseId,
    },
    productionEligibility: {
      canonicalRepository: CANONICAL_REPOSITORY,
      canonicalWorkflowPath: CANONICAL_WORKFLOW_PATH,
      requiredEvent: 'push',
      requiredRef: CANONICAL_RELEASE_REF,
      candidate: true,
      reasons: [],
      externalChecksRequired: [
        'workflow_conclusion_success',
        'immutable_github_artifact_id',
        'authenticated_github_artifact_digest',
        'expected_release_identity',
        'protected_environment_authorization',
      ],
    },
  };
};

const createFixture = () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-release-preparation-'));
  const layout = {
    trustedRoot: fixtureRoot,
    releasesRoot: path.join(fixtureRoot, 'opt/releases'),
    dependenciesRoot: path.join(fixtureRoot, 'opt/dependencies'),
    npmCacheRoot: path.join(fixtureRoot, 'cache/npm'),
    puppeteerCacheRoot: path.join(fixtureRoot, 'cache/puppeteer'),
    persistentRoot: path.join(fixtureRoot, 'state'),
    installerHomeRoot: path.join(fixtureRoot, 'state/deploy/installer-home'),
  };
  for (const directory of [
    layout.releasesRoot,
    path.join(layout.dependenciesRoot, 'backend'),
    path.join(layout.dependenciesRoot, 'ui-server'),
    layout.npmCacheRoot,
    layout.puppeteerCacheRoot,
    path.join(layout.persistentRoot, 'logs/backend'),
    path.join(layout.persistentRoot, 'logs/ui-server'),
    path.join(layout.persistentRoot, 'runtime/backend'),
    layout.installerHomeRoot,
  ]) mkdir(directory);
  for (const logPath of [
    'logs/backend/error.log',
    'logs/backend/combined.log',
    'logs/ui-server/error.log',
    'logs/ui-server/combined.log',
  ]) writeRelative(layout.persistentRoot, logPath, Buffer.from(''));

  const releaseRoot = path.join(layout.releasesRoot, releaseId);
  mkdir(releaseRoot);
  const payload = new Map();
  for (const filePath of REQUIRED_PAYLOAD_FILES) {
    payload.set(filePath, Buffer.from(`fixture:${filePath}\n`, 'utf8'));
  }
  payload.set('be/package.json', Buffer.from('{"name":"be"}\n'));
  payload.set('be/package-lock.json', Buffer.from('{"name":"be","lockfileVersion":3}\n'));
  payload.set('ui-server/package.json', Buffer.from('{"name":"ui-server"}\n'));
  payload.set('ui-server/package-lock.json', Buffer.from('{"name":"ui-server","lockfileVersion":3}\n'));
  payload.set('ui/build/static/js/main.fixture.js', Buffer.from('globalThis.fixture=true;\n'));
  for (const [filePath, data] of payload) writeRelative(releaseRoot, filePath, data);
  const manifest = buildManifest(payload);
  writeRelative(releaseRoot, 'release-manifest.json', serializeReleaseManifest(manifest));

  const cleanup = () => rmSync(fixtureRoot, { recursive: true, force: true });
  const plan = () => createReleasePreparationPlan({
    expectedReleaseId: releaseId,
    expectedSourceSha: sourceSha,
    trustedLayout: layout,
  });
  return { fixtureRoot, layout, releaseRoot, payload, manifest, cleanup, plan };
};

const withFixture = async (callback) => {
  const fixture = createFixture();
  try {
    await callback(fixture);
  } finally {
    fixture.cleanup();
  }
};

const fakeInstall = async (execution) => {
  assert.equal(execution.executable, '/usr/bin/npm');
  assert.deepEqual(execution.args, ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts']);
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(Object.isFrozen(execution.env), true);
  assert.equal(execution.env.HOME.endsWith(path.join('state', 'deploy', 'installer-home')), true);
  assert.equal(execution.env.NPM_CONFIG_CACHE.endsWith(path.join('cache', 'npm')), true);
  assert.equal(execution.env.PUPPETEER_CACHE_DIR.endsWith(path.join('cache', 'puppeteer')), true);
  mkdir(path.join(execution.cwd, 'node_modules/example-package'));
  writeRelative(
    path.join(execution.cwd, 'node_modules'),
    'example-package/index.js',
    Buffer.from('export const fixture = true;\n'),
  );
  return { exitCode: 0 };
};

const dependencyBudget = {
  layers: {
    backend: { bytes: 1000, inodes: 100 },
    'ui-server': { bytes: 200, inodes: 20 },
  },
  caches: {
    npm: { bytes: 300, inodes: 30 },
    puppeteer: { bytes: 400, inodes: 40 },
  },
  safetyMargin: { bytes: 500, inodes: 50 },
};

const capacityEvidenceFor = (plan, publicationState, available) => {
  const targetPaths = [];
  for (const component of ['backend', 'ui-server']) {
    if (publicationState[component] !== 'reuse') {
      targetPaths.push(plan.dependencies[component].componentRoot);
    }
  }
  if (targetPaths.length > 0) {
    targetPaths.push(plan.layout.npmCacheRoot, plan.layout.puppeteerCacheRoot);
  }
  return {
    measuredAtUtc: new Date().toISOString(),
    filesystems: [...new Set(targetPaths)].sort().map((targetPath) => ({
      targetPath,
      device: lstatSync(targetPath, { bigint: true }).dev.toString(),
      availableBytes: available.bytes,
      availableInodes: available.inodes,
    })),
  };
};

const capacityFor = (plan, available = { bytes: 10_000, inodes: 10_000 }) => {
  const publicationState = inspectDependencyPublicationState(plan);
  return calculateDependencyCapacity({
    plan,
    publicationState,
    trustedBudget: dependencyBudget,
    available: capacityEvidenceFor(plan, publicationState, available),
  });
};

const publishBoth = async (plan) => {
  await publishDependencyLayer({
    plan,
    component: 'backend',
    capacityCalculation: capacityFor(plan),
    executor: fakeInstall,
  });
  await publishDependencyLayer({
    plan,
    component: 'ui-server',
    capacityCalculation: capacityFor(plan),
    executor: fakeInstall,
  });
};

test('derives immutable release, dependency, cache, and managed-link plans from trusted identity', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(plan.releaseId, releaseId);
    assert.equal(plan.sourceSha, sourceSha);
    assert.equal(plan.payloadFileCount, fixture.manifest.fileCount);
    assert.equal(plan.dependencies.backend.lockHash, fixture.manifest.lockfiles['be/package-lock.json']);
    assert.equal(plan.dependencies['ui-server'].lockHash, fixture.manifest.lockfiles['ui-server/package-lock.json']);
    assert.equal(
      plan.dependencies.backend.finalPath,
      path.join(fixture.layout.dependenciesRoot, 'backend', plan.dependencies.backend.layerKey),
    );
    assert.equal(plan.dependencies.backend.npmCacheRoot, fixture.layout.npmCacheRoot);
    assert.equal(plan.dependencies.backend.puppeteerCacheRoot, fixture.layout.puppeteerCacheRoot);
    assert.deepEqual(plan.managedLinks.map((item) => item.relativePath), [
      'be/node_modules',
      'be/error.log',
      'be/combined.log',
      'be/runtime',
      'ui-server/node_modules',
      'ui-server/error.log',
      'ui-server/combined.log',
    ]);
    assert.deepEqual(inspectDependencyPublicationState(plan), {
      backend: 'install',
      'ui-server': 'install',
    });
  });
});

test('production layout treats the filesystem root as a trusted ancestor', () => {
  assert.throws(
    () => createReleasePreparationPlan({
      expectedReleaseId: releaseId,
      expectedSourceSha: sourceSha,
      trustedLayout: PRODUCTION_RELEASE_LAYOUT,
    }),
    /Release root is missing/,
  );
});

test('rejects traversal-shaped identity and source/release or candidate mismatches', async () => {
  await withFixture(async (fixture) => {
    assert.throws(
      () => createReleasePreparationPlan({
        expectedReleaseId: '../release',
        expectedSourceSha: sourceSha,
        trustedLayout: fixture.layout,
      }),
      /release ID is invalid/,
    );
    assert.throws(
      () => createReleasePreparationPlan({
        expectedReleaseId: releaseId,
        expectedSourceSha: `f${sourceSha.slice(1)}`,
        trustedLayout: fixture.layout,
      }),
      /source SHA does not match trusted evidence/,
    );

    const changed = { ...fixture.manifest, productionEligibility: {
      ...fixture.manifest.productionEligibility,
      candidate: false,
      reasons: ['event_not_push'],
    } };
    writeFileSync(path.join(fixture.releaseRoot, 'release-manifest.json'), serializeReleaseManifest(changed));
    assert.throws(() => fixture.plan(), /not a canonical production candidate/);
  });
});

test('rejects non-canonical manifests, unexpected files, links, and mutated payload snapshots', async () => {
  await withFixture(async (fixture) => {
    const manifestPath = path.join(fixture.releaseRoot, 'release-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(fixture.manifest));
    assert.throws(() => fixture.plan(), /not canonical JSON/);
    writeFileSync(manifestPath, serializeReleaseManifest(fixture.manifest));

    writeRelative(fixture.releaseRoot, 'be/unexpected.txt', Buffer.from('unexpected'));
    assert.throws(() => fixture.plan(), /file inventory.*unexpected or missing/i);
    rmSync(path.join(fixture.releaseRoot, 'be/unexpected.txt'));

    const plan = fixture.plan();
    writeFileSync(path.join(fixture.releaseRoot, 'be/package.json'), '{"name":"mutated"}\n');
    assert.throws(() => assertReleaseSnapshotUnchanged(plan), /does not match the verified manifest/);
  });

  await withFixture(async (fixture) => {
    const external = path.join(fixture.fixtureRoot, 'external');
    mkdir(external);
    symlinkSync(external, path.join(fixture.releaseRoot, 'be/host-link'), 'junction');
    assert.throws(() => fixture.plan(), /symbolic link/);
  });
});

test('every release snapshot rejects nested writable directories', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX release directory mode assertions do not apply on Windows');
    return;
  }
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    chmodSync(path.join(fixture.releaseRoot, 'be/dist'), 0o777);
    assert.throws(
      () => assertReleaseSnapshotUnchanged(plan),
      /Extracted release directory is group- or world-writable: be\/dist/,
    );
  });
});

test('rejects partial residue and malformed existing dependency directories', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    mkdir(plan.dependencies.backend.partialPath);
    assert.throws(() => inspectDependencyPublicationState(plan), /Partial backend dependency layer|Partial backend dependency residue/);
    rmSync(plan.dependencies.backend.partialPath, { recursive: true });

    mkdir(plan.dependencies.backend.finalPath);
    writeRelative(plan.dependencies.backend.finalPath, 'wrong.txt', Buffer.from('wrong'));
    assert.throws(() => inspectDependencyPublicationState(plan), /unexpected or missing entries/);
  });
});

test('calculates plan-bound byte and inode budgets and fails closed on forgery or shortfall', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const state = inspectDependencyPublicationState(plan);
    const enough = calculateDependencyCapacity({
      plan,
      publicationState: state,
      trustedBudget: dependencyBudget,
      available: capacityEvidenceFor(plan, state, { bytes: 2400, inodes: 240 }),
    });
    assert.equal(enough.schemaVersion, 1);
    assert.equal(enough.planSha256, plan.planSha256);
    assert.equal(enough.publicationStateKey, 'backend:install|ui-server:install');
    assert.equal(enough.requiredBytes, 2400n);
    assert.equal(enough.requiredInodes, 240n);
    assert.equal(enough.availableBytes, 2400n);
    assert.equal(enough.availableInodes, 240n);
    assert.equal(enough.byteShortfall, 0n);
    assert.equal(enough.inodeShortfall, 0n);
    assert.equal(enough.sufficient, true);
    assert.deepEqual(enough.installs, ['backend', 'ui-server']);
    assert.equal(assertSufficientDependencyCapacity(enough), true);
    assert.throws(
      () => assertSufficientDependencyCapacity({
        sufficient: true,
        byteShortfall: 0n,
        inodeShortfall: 0n,
      }),
      /Insufficient disk bytes or inodes/,
    );
    assert.throws(
      () => calculateDependencyCapacity({
        plan,
        publicationState: { backend: 'reuse', 'ui-server': 'install' },
        trustedBudget: dependencyBudget,
        available: capacityEvidenceFor(plan, state, { bytes: 2400, inodes: 240 }),
      }),
      /not bound to this verified release plan/,
    );

    const short = calculateDependencyCapacity({
      plan,
      publicationState: state,
      trustedBudget: dependencyBudget,
      available: capacityEvidenceFor(plan, state, { bytes: 2399, inodes: 239 }),
    });
    assert.equal(short.byteShortfall, 1n);
    assert.equal(short.inodeShortfall, 1n);
    assert.throws(() => assertSufficientDependencyCapacity(short), /Insufficient disk bytes or inodes/);
  });
});

test('publishes a dependency layer atomically through an injected executor and reuses it', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const published = await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: fakeInstall,
    });
    assert.deepEqual(published, {
      component: 'backend',
      status: 'published',
      finalPath: plan.dependencies.backend.finalPath,
    });
    assert.deepEqual(inspectDependencyPublicationState(plan), {
      backend: 'reuse',
      'ui-server': 'install',
    });
    const marker = JSON.parse(readFileSync(
      path.join(plan.dependencies.backend.finalPath, '.omnilodge-dependency.json'),
      'utf8',
    ));
    assert.equal(marker.tree.algorithm, 'sha256');
    assert.match(marker.tree.digest, /^[0-9a-f]{64}$/);
    assert.equal(Number.isSafeInteger(marker.tree.entryCount) && marker.tree.entryCount > 0, true);
    assert.equal(Number.isSafeInteger(marker.tree.fileBytes) && marker.tree.fileBytes > 0, true);
    let called = false;
    const reused = await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: async () => {
        called = true;
        return { exitCode: 0 };
      },
    });
    assert.equal(called, false);
    assert.equal(reused.status, 'reused');
  });
});

test('requires a sufficient capacity proof bound to the exact plan and current publication state', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    let called = false;
    const executor = async () => {
      called = true;
      return { exitCode: 0 };
    };
    await assert.rejects(
      () => publishDependencyLayer({ plan, component: 'backend', executor }),
      /Insufficient disk bytes or inodes/,
    );
    assert.equal(called, false);

    const insufficient = capacityFor(plan, { bytes: 1, inodes: 1 });
    await assert.rejects(
      () => publishDependencyLayer({
        plan,
        component: 'backend',
        capacityCalculation: insufficient,
        executor,
      }),
      /Insufficient disk bytes or inodes/,
    );
    assert.equal(called, false);

    const initialCapacity = capacityFor(plan);
    await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: initialCapacity,
      executor: fakeInstall,
    });
    await assert.rejects(
      () => publishDependencyLayer({
        plan,
        component: 'ui-server',
        capacityCalculation: initialCapacity,
        executor,
      }),
      /capacity proof is stale/,
    );
    assert.equal(called, false);
  });

  const first = createFixture();
  const second = createFixture();
  try {
    const firstPlan = first.plan();
    const secondPlan = second.plan();
    const foreignCapacity = capacityFor(secondPlan);
    await assert.rejects(
      () => publishDependencyLayer({
        plan: firstPlan,
        component: 'backend',
        capacityCalculation: foreignCapacity,
        executor: fakeInstall,
      }),
      /different release plan/,
    );
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

test('dependency tree seal rejects a modified nested dependency file', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: fakeInstall,
    });
    writeFileSync(
      path.join(plan.dependencies.backend.nodeModulesPath, 'example-package/index.js'),
      'export const fixture = false;\n',
    );
    assert.throws(
      () => inspectDependencyPublicationState(plan),
      /invalid publication marker/,
    );
  });
});

test('dependency tree seal rejects writable nested dependency files and directories', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX dependency mode assertions do not apply on Windows');
    return;
  }
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: fakeInstall,
    });
    const nestedFile = path.join(plan.dependencies.backend.nodeModulesPath, 'example-package/index.js');
    chmodSync(nestedFile, 0o666);
    assert.throws(() => inspectDependencyPublicationState(plan), /file is group- or world-writable/);
  });
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: fakeInstall,
    });
    const nestedDirectory = path.join(plan.dependencies.backend.nodeModulesPath, 'example-package');
    chmodSync(nestedDirectory, 0o777);
    assert.throws(() => inspectDependencyPublicationState(plan), /directory is group- or world-writable/);
  });
});

test('dependency tree seal allows in-tree npm links and rejects escaping links', async (context) => {
  if (process.platform === 'win32') {
    context.skip('Creating npm-style file symlinks is not permitted by this Windows environment');
    return;
  }
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: async (execution) => {
        mkdir(path.join(execution.cwd, 'node_modules/example-package'));
        writeRelative(
          path.join(execution.cwd, 'node_modules'),
          'example-package/index.js',
          Buffer.from('#!/usr/bin/env node\n'),
        );
        mkdir(path.join(execution.cwd, 'node_modules/.bin'));
        symlinkSync('../example-package/index.js', path.join(execution.cwd, 'node_modules/.bin/example'));
        return { exitCode: 0 };
      },
    });
    assert.equal(inspectDependencyPublicationState(plan).backend, 'reuse');

    const outside = path.join(fixture.fixtureRoot, 'outside');
    mkdir(outside);
    const escapingLink = path.join(plan.dependencies.backend.nodeModulesPath, 'escape');
    const relativeTarget = path.relative(path.dirname(escapingLink), outside);
    symlinkSync(relativeTarget, escapingLink, 'dir');
    assert.throws(
      () => inspectDependencyPublicationState(plan),
      /symlink escapes its dependency layer|resolves outside its dependency layer/,
    );
  });
});

test('dependency tree seal rejects a mismatched canonical marker', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await publishDependencyLayer({
      plan,
      component: 'backend',
      capacityCalculation: capacityFor(plan),
      executor: fakeInstall,
    });
    const markerPath = path.join(plan.dependencies.backend.finalPath, '.omnilodge-dependency.json');
    chmodSync(markerPath, 0o644);
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    marker.tree.digest = 'f'.repeat(64);
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    assert.throws(() => inspectDependencyPublicationState(plan), /invalid publication marker/);
  });
});

test('re-hashes release inputs after execution and preserves detectable partial residue on failure', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await assert.rejects(
      () => publishDependencyLayer({
        plan,
        component: 'backend',
        capacityCalculation: capacityFor(plan),
        executor: async (execution) => {
          mkdir(path.join(execution.cwd, 'node_modules'));
          writeFileSync(plan.dependencies.backend.sourceLockPath, '{"mutated":true}\n');
          return { exitCode: 0 };
        },
      }),
      /does not match the verified manifest|changed during preparation/,
    );
    assert.throws(
      () => inspectDependencyPublicationState(plan),
      /changed|does not match the verified manifest|Partial backend dependency layer|Partial backend dependency residue/,
    );
  });

  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await assert.rejects(
      () => publishDependencyLayer({
        plan,
        component: 'backend',
        capacityCalculation: capacityFor(plan),
        executor: async (execution) => {
          mkdir(path.join(execution.cwd, 'node_modules'));
          chmodSync(path.join(execution.cwd, 'package-lock.json'), 0o644);
          writeFileSync(path.join(execution.cwd, 'package-lock.json'), '{"mutated":true}\n');
          return { exitCode: 0 };
        },
      }),
      /staged lockfile changed/,
    );
    assert.throws(() => inspectDependencyPublicationState(plan), /Partial backend dependency layer|Partial backend dependency residue/);
  });
});

test('validates the exact prepared-release symlink allowlist and rejects extras', async (context) => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    await publishBoth(plan);
    try {
      for (const entry of plan.managedLinks) {
        symlinkSync(
          entry.targetPath,
          entry.linkPath,
          entry.targetType === 'directory' ? 'junction' : 'file',
        );
      }
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'UNKNOWN'].includes(error.code)) {
        context.skip('Creating file symlinks is not permitted by this Windows environment');
        return;
      }
      throw error;
    }
    assert.equal(validatePreparedReleaseLinks(plan), true);
    const extraTarget = path.join(fixture.fixtureRoot, 'extra-target');
    mkdir(extraTarget);
    symlinkSync(extraTarget, path.join(fixture.releaseRoot, 'be/extra-link'), 'junction');
    assert.throws(() => validatePreparedReleaseLinks(plan), /managed-link inventory.*unexpected or missing/i);
  });
});
