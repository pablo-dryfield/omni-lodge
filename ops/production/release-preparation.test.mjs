import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
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
  prepareReleaseManagedLinks,
  publishDependencyLayer,
  validatePreparedReleaseLinks,
} from './libexec/deploy/release-preparation.mjs';
import {
  prepareForwardReleaseArtifact,
  prepareDependencyLayers,
  prepareBackendBrowserCache,
  runPrivateSmokeChecks,
  runDryRunRuntimeChecks,
} from './libexec/deploy/worker.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceSha = 'a'.repeat(40);
const releaseId = `omnilodge-r12345-a2-${sourceSha.slice(0, 12)}`;

const mkdir = (directory) => mkdirSync(directory, { recursive: true, mode: 0o755 });

const writeRelative = (root, relativePath, bytes) => {
  const destination = path.join(root, ...relativePath.split('/'));
  mkdir(path.dirname(destination));
  writeFileSync(destination, bytes, { mode: 0o644 });
};

const createMemoryStateFileOps = () => {
  const files = new Map();
  return {
    files,
    async publishExclusiveBuffer(targetPath, bytes) {
      if (files.has(targetPath)) {
        const error = new Error('exists');
        error.code = 'EEXIST';
        throw error;
      }
      files.set(targetPath, Buffer.from(bytes));
      return { path: targetPath, stat: { size: BigInt(bytes.length) } };
    },
    async readSecureBuffer(targetPath) {
      const bytes = files.get(targetPath);
      if (!bytes) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return { path: targetPath, bytes: Buffer.from(bytes), stat: { size: BigInt(bytes.length) } };
    },
  };
};

class FakeSmokeProcess extends EventEmitter {
  exitCode = null;
  signalCode = null;
  killed = false;

  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.signalCode = signal;
    this.emit('exit', null, signal);
    return true;
  }
}

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

    const observedAt = Date.parse('2026-09-21T12:00:00.000Z');
    const laterNow = () => new Date(observedAt + (4 * 60 * 1000));
    const stillFreshEvidence = capacityEvidenceFor(plan, state, { bytes: 2400, inodes: 240 });
    stillFreshEvidence.measuredAtUtc = new Date(observedAt).toISOString();
    assert.equal(calculateDependencyCapacity({
      plan,
      publicationState: state,
      trustedBudget: dependencyBudget,
      available: stillFreshEvidence,
      now: laterNow,
    }).sufficient, true);

    const tooLateNow = () => new Date(observedAt + (5 * 60 * 1000) + 1);
    assert.throws(
      () => calculateDependencyCapacity({
        plan,
        publicationState: state,
        trustedBudget: dependencyBudget,
        available: stillFreshEvidence,
        now: tooLateNow,
      }),
      /Dependency capacity evidence is stale or from the future/,
    );
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

test('worker dependency preparation publishes both runtime layers with fresh capacity proofs', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const prepared = await prepareDependencyLayers({
      plan,
      trustedBudget: dependencyBudget,
      measureCapacity: ({ publicationState }) =>
        capacityEvidenceFor(plan, publicationState, { bytes: 10_000, inodes: 10_000 }),
      executor: fakeInstall,
    });
    assert.deepEqual(prepared.components.map((item) => [
      item.component,
      item.previousState,
      item.status,
      item.capacity.publicationStateKey,
    ]), [
      ['backend', 'install', 'published', 'backend:install|ui-server:install'],
      ['ui-server', 'install', 'published', 'backend:reuse|ui-server:install'],
    ]);
    assert.equal(prepared.preparationState, 'partial');
    assert.deepEqual(prepared.dependencies, {
      backend: 'prepared',
      'ui-server': 'prepared',
    });
    assert.deepEqual(inspectDependencyPublicationState(plan), {
      backend: 'reuse',
      'ui-server': 'reuse',
    });
  });
});

test('forward artifact preparation keeps stage lightweight and reserves dependency work for dry-run', async () => {
  await withFixture(async (fixture) => {
    const requestId = '923e4567-e89b-42d3-a456-426614174012';
    const basePaths = {
      incomingRoot: path.join(fixture.fixtureRoot, 'incoming'),
      stagingRoot: path.join(fixture.fixtureRoot, 'staging'),
      stateRoot: path.join(fixture.fixtureRoot, 'state-files'),
    };
    const extraction = {
      releaseId,
      artifactZipSha256: '3'.repeat(64),
      operation: { name: 'stage', trigger: 'manual' },
      archivePath: path.join(fixture.fixtureRoot, 'release.tar.gz'),
      checksumPath: path.join(fixture.fixtureRoot, 'release.tar.gz.sha256'),
      productionEvidence: { fixture: true },
      archiveSha256: '4'.repeat(64),
    };
    const requestState = (operation) => ({
      request: { kind: 'forward_submit', requestId },
      intent: {
        releaseId,
        sourceSha,
        artifactZipSha256: extraction.artifactZipSha256,
        operation,
        trigger: 'manual',
      },
    });

    const stageFiles = createMemoryStateFileOps();
    let dependencyCalls = 0;
    let managedLinkCalls = 0;
    let browserCacheCalls = 0;
    let dryRunCheckCalls = 0;
    const stageResult = await prepareForwardReleaseArtifact({
      requestState: requestState('stage'),
      paths: basePaths,
      trustedLayout: fixture.layout,
      fileOps: stageFiles,
      extractArtifact: async () => extraction,
      prepareDependencies: async () => {
        dependencyCalls += 1;
        throw new Error('stage must not prepare dependencies');
      },
      prepareManagedLinks: () => {
        managedLinkCalls += 1;
        throw new Error('stage must not prepare managed links');
      },
      prepareBrowserCache: async () => {
        browserCacheCalls += 1;
        throw new Error('stage must not prepare browser cache');
      },
      runDryRunChecks: async () => {
        dryRunCheckCalls += 1;
        throw new Error('stage must not run dry-run checks');
      },
    });
    assert.equal(stageResult.preparationState, 'unlinked');
    assert.equal(stageResult.dependencyPreparationState, null);
    assert.equal(stageResult.managedLinkCount, 0);
    assert.equal(dependencyCalls, 0);
    assert.equal(managedLinkCalls, 0);
    assert.equal(browserCacheCalls, 0);
    assert.equal(dryRunCheckCalls, 0);
    assert.equal([...stageFiles.files.keys()].some((filePath) => filePath.endsWith('.dependency-preparation-result.json')), false);
    assert.equal([...stageFiles.files.keys()].some((filePath) => filePath.endsWith('.managed-links-result.json')), false);
    assert.equal([...stageFiles.files.keys()].some((filePath) => filePath.endsWith('.browser-cache-result.json')), false);
    assert.equal([...stageFiles.files.keys()].some((filePath) => filePath.endsWith('.dry-run-checks-result.json')), false);

    const dryRunFiles = createMemoryStateFileOps();
    const dryRunExtraction = {
      ...extraction,
      operation: { name: 'dry-run', trigger: 'manual' },
    };
    const dryRunResult = await prepareForwardReleaseArtifact({
      requestState: requestState('dry-run'),
      paths: basePaths,
      trustedLayout: fixture.layout,
      fileOps: dryRunFiles,
      extractArtifact: async () => dryRunExtraction,
      prepareDependencies: async ({ plan }) => ({
        schemaVersion: 1,
        releaseId: plan.releaseId,
        sourceSha: plan.sourceSha,
        preparationPlanSha256: plan.planSha256,
        startedAtUtc: '2026-09-16T12:00:00.000Z',
        completedAtUtc: '2026-09-16T12:00:00.000Z',
        components: [],
        preparationState: 'partial',
        releaseLinks: 'unlinked',
        dependencies: { backend: 'prepared', 'ui-server': 'prepared' },
      }),
      prepareManagedLinks: (plan) => ({
        releaseId: plan.releaseId,
        linkCount: plan.managedLinks.length,
        created: plan.managedLinks.map((entry) => entry.relativePath),
        reused: [],
      }),
      prepareBrowserCache: async ({ plan }) => ({
        schemaVersion: 1,
        releaseId: plan.releaseId,
        sourceSha: plan.sourceSha,
        preparationPlanSha256: plan.planSha256,
        cacheRoot: plan.layout.puppeteerCacheRoot,
        command: {
          label: 'puppeteer-browser-cache',
          executable: '/usr/bin/node',
          args: ['node_modules/puppeteer/install.mjs'],
          cwd: path.join(plan.releaseRoot, 'be'),
        },
        capturedAtUtc: '2026-09-16T12:00:00.000Z',
      }),
      runDryRunChecks: async ({ plan }) => ({
        schemaVersion: 1,
        releaseId: plan.releaseId,
        sourceSha: plan.sourceSha,
        preparationPlanSha256: plan.planSha256,
        backendEnvironmentFile: '/etc/omnilodge/backend.env',
        commands: [],
        migrationStatus: {
          schemaVersion: 1,
          kind: 'omnilodge-migration-status',
          ok: true,
          pendingMigrationCount: 0,
          pendingMigrationNames: [],
        },
        runtimePreflight: {
          schemaVersion: 1,
          kind: 'omnilodge-backend-runtime-preflight',
          ok: true,
          checks: {},
        },
        capturedAtUtc: '2026-09-16T12:00:00.000Z',
      }),
    });
    assert.equal(dryRunResult.dependencyPreparationState, 'partial');
    assert.equal(dryRunResult.managedLinkCount, 7);
    assert.equal(dryRunResult.browserCachePrepared, true);
    assert.equal(dryRunResult.dryRunChecksPassed, true);
    assert.equal([...dryRunFiles.files.keys()].some((filePath) => filePath.endsWith('.dependency-preparation-result.json')), true);
    assert.equal([...dryRunFiles.files.keys()].some((filePath) => filePath.endsWith('.managed-links-result.json')), true);
    assert.equal([...dryRunFiles.files.keys()].some((filePath) => filePath.endsWith('.browser-cache-result.json')), true);
    assert.equal([...dryRunFiles.files.keys()].some((filePath) => filePath.endsWith('.dry-run-checks-result.json')), true);
  });
});

test('dry-run runtime checks use fixed Ubuntu runtime commands and parse JSON evidence', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const commands = [];
    const result = await runDryRunRuntimeChecks({
      plan,
      executor: async (execution) => {
        commands.push(execution);
        if (execution.label === 'migration-status') {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              schemaVersion: 1,
              kind: 'omnilodge-migration-status',
              ok: true,
              pendingMigrationCount: 0,
              pendingMigrationNames: [],
            }),
            stderr: '',
          };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            kind: 'omnilodge-backend-runtime-preflight',
            ok: true,
            checks: {
              productionConfiguration: true,
              databaseSyncPolicy: true,
              accessControlSeedPolicy: true,
              databaseReadOnlyProbe: true,
              sharpNativeOperation: true,
              puppeteerBrowserLaunch: true,
            },
          }),
          stderr: '',
        };
      },
      privateSmokeRunner: async ({ plan: smokePlan }) => ({
        schemaVersion: 1,
        releaseId: smokePlan.releaseId,
        sourceSha: smokePlan.sourceSha,
        preparationPlanSha256: smokePlan.planSha256,
        host: '127.0.0.1',
        startedAtUtc: '2026-09-16T12:00:00.000Z',
        completedAtUtc: '2026-09-16T12:00:01.000Z',
        commands: [],
        backend: {
          port: 49152,
          path: '/api/health/ready',
          statusCode: 200,
          ready: true,
          release: {
            id: smokePlan.releaseId,
            gitSha: smokePlan.sourceSha,
            runtimeMode: 'dry-run',
          },
        },
        uiServer: {
          port: 49153,
          tls: {
            keyPath: '/etc/omnilodge/tls/origin.key',
            certPath: '/etc/omnilodge/tls/origin.pem',
            loopbackPeerVerification: 'disabled',
          },
          health: {
            path: '/healthz',
            statusCode: 200,
            release: smokePlan.releaseId,
            artifactValidation: {
              status: 'valid',
              mainAsset: '/static/js/main.12345678.js',
              assetCount: 10,
              hashedAssetCount: 3,
              pwaManifestCount: 1,
            },
          },
          index: {
            path: '/',
            statusCode: 200,
            servedApplicationShell: true,
          },
          sourceMapProbe: {
            path: '/static/js/main.12345678.js.map',
            statusCode: 404,
            publicSourceMapsDenied: true,
          },
        },
      }),
    });
    assert.deepEqual(commands.map((command) => [
      command.label,
      command.executable,
      command.cwd,
      command.args,
      command.env.NODE_ENV,
      command.env.APP_VERSION,
      command.env.PUPPETEER_CACHE_DIR,
    ]), [
      [
        'migration-status',
        '/usr/bin/node',
        path.join(plan.releaseRoot, 'be'),
        ['--env-file=/etc/omnilodge/backend.env', '--enable-source-maps', 'dist/scripts/reportMigrationStatus.js'],
        'production',
        plan.releaseId,
        plan.layout.puppeteerCacheRoot,
      ],
      [
        'runtime-preflight',
        '/usr/bin/node',
        path.join(plan.releaseRoot, 'be'),
        ['--env-file=/etc/omnilodge/backend.env', '--enable-source-maps', 'dist/scripts/runtimePreflight.js'],
        'production',
        plan.releaseId,
        plan.layout.puppeteerCacheRoot,
      ],
    ]);
    assert.equal(result.backendEnvironmentFile, '/etc/omnilodge/backend.env');
    assert.equal(result.migrationStatus.ok, true);
    assert.equal(result.runtimePreflight.ok, true);
    assert.equal(result.privateSmoke.backend.ready, true);
    assert.equal(result.privateSmoke.uiServer.sourceMapProbe.publicSourceMapsDenied, true);
  });
});

test('private smoke starts candidate backend and UI server on loopback without current pointers', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const commands = [];
    const stopped = [];
    const responses = new Map([
      ['4001 /api/health/ready', {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          status: 'ok',
          ready: true,
          release: {
            id: plan.releaseId,
            gitSha: plan.sourceSha,
            runtimeMode: 'dry-run',
          },
          checks: {
            configuration: { ok: true, missing: [], invalid: [] },
            database: { ok: true },
          },
        }),
      }],
      ['4002 /healthz', {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          status: 'ok',
          service: 'ui-server',
          release: plan.releaseId,
          artifactValidation: {
            status: 'valid',
            mainAsset: '/static/js/main.12345678.js',
            assetCount: 12,
            hashedAssetCount: 5,
            pwaManifestCount: 3,
          },
        }),
      }],
      ['4002 /', {
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
      }],
      ['4002 /static/js/main.12345678.js.map', {
        statusCode: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: 'Not Found',
      }],
    ]);

    const result = await runPrivateSmokeChecks({
      plan,
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      portAllocator: async (component) => (component === 'backend' ? 4001 : 4002),
      spawnProcess: (command) => {
        commands.push(command);
        const child = new FakeSmokeProcess();
        child.once('exit', () => stopped.push(command.component));
        return child;
      },
      request: async ({ port, requestPath }) => {
        const response = responses.get(`${port} ${requestPath}`);
        if (!response) throw new Error(`unexpected smoke request: ${port} ${requestPath}`);
        return response;
      },
      sleep: async () => {},
    });

    assert.deepEqual(commands.map((command) => [
      command.component,
      command.executable,
      command.cwd,
      command.args,
      command.env.NODE_ENV,
      command.env.APP_VERSION,
      command.env.PORT ?? command.env.UI_SERVER_PORT,
      command.env.UI_SERVER_HOST ?? null,
      command.env.UI_BUILD_PATH ?? null,
      command.env.UI_TLS_KEY_PATH ?? null,
    ]), [
      [
        'backend',
        '/usr/bin/node',
        path.join(plan.releaseRoot, 'be'),
        ['--env-file=/etc/omnilodge/backend.env', '--enable-source-maps', 'scripts/startMonitored.js', 'dist/app.js'],
        'production',
        plan.releaseId,
        '4001',
        null,
        null,
        null,
      ],
      [
        'ui-server',
        '/usr/bin/node',
        path.join(plan.releaseRoot, 'ui-server'),
        ['--env-file=/etc/omnilodge/ui-server.env', 'server.js'],
        'production',
        plan.releaseId,
        '4002',
        '127.0.0.1',
        path.join(plan.releaseRoot, 'ui/build'),
        '/etc/omnilodge/tls/origin.key',
      ],
    ]);
    assert.equal(result.backend.port, 4001);
    assert.equal(result.backend.release.runtimeMode, 'dry-run');
    assert.equal(result.uiServer.port, 4002);
    assert.equal(result.uiServer.health.artifactValidation.status, 'valid');
    assert.equal(result.uiServer.sourceMapProbe.statusCode, 404);
    assert.deepEqual(stopped.sort(), ['backend', 'ui-server']);
  });
});

test('private smoke keeps the worker alive while waiting for candidate readiness', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const attempts = new Map();
    const responseFor = (port, requestPath) => {
      if (port === 4101 && requestPath === '/api/health/ready') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            status: 'ok',
            ready: true,
            release: {
              id: plan.releaseId,
              gitSha: plan.sourceSha,
              runtimeMode: 'dry-run',
            },
            checks: {
              configuration: { ok: true, missing: [], invalid: [] },
              database: { ok: true },
            },
          }),
        };
      }
      if (port === 4102 && requestPath === '/healthz') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            status: 'ok',
            service: 'ui-server',
            release: plan.releaseId,
            artifactValidation: {
              status: 'valid',
              mainAsset: '/static/js/main.12345678.js',
              assetCount: 12,
              hashedAssetCount: 5,
              pwaManifestCount: 3,
            },
          }),
        };
      }
      if (port === 4102 && requestPath === '/') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: '<!doctype html><html><body><div id="root"></div></body></html>',
        };
      }
      if (port === 4102 && requestPath === '/static/js/main.12345678.js.map') {
        return {
          statusCode: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          body: 'Not Found',
        };
      }
      throw new Error(`unexpected smoke request: ${port} ${requestPath}`);
    };

    const result = await runPrivateSmokeChecks({
      plan,
      portAllocator: async (component) => (component === 'backend' ? 4101 : 4102),
      spawnProcess: () => new FakeSmokeProcess(),
      request: async ({ port, requestPath }) => {
        const key = `${port} ${requestPath}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        if (key === '4101 /api/health/ready' && attempt === 1) {
          throw new Error('candidate is still starting');
        }
        return responseFor(port, requestPath);
      },
    });

    assert.equal(result.backend.ready, true);
    assert.equal(attempts.get('4101 /api/health/ready'), 2);
  });
});

test('backend browser-cache preparation runs the reviewed Puppeteer install entrypoint', async () => {
  await withFixture(async (fixture) => {
    const plan = fixture.plan();
    const commands = [];
    const result = await prepareBackendBrowserCache({
      plan,
      executor: async (execution) => {
        commands.push(execution);
        return { exitCode: 0 };
      },
    });
    assert.deepEqual(commands.map((command) => [
      command.label,
      command.executable,
      command.cwd,
      command.args,
      command.env.NODE_ENV,
      command.env.APP_VERSION,
      command.env.PUPPETEER_CACHE_DIR,
    ]), [
      [
        'puppeteer-browser-cache',
        '/usr/bin/node',
        path.join(plan.releaseRoot, 'be'),
        ['node_modules/puppeteer/install.mjs'],
        'production',
        plan.releaseId,
        plan.layout.puppeteerCacheRoot,
      ],
    ]);
    assert.equal(result.cacheRoot, plan.layout.puppeteerCacheRoot);
    assert.equal(result.command.executable, '/usr/bin/node');
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
      const prepared = prepareReleaseManagedLinks(plan);
      assert.equal(prepared.linkCount, plan.managedLinks.length);
      assert.deepEqual(prepared.created, plan.managedLinks.map((entry) => entry.relativePath));
      const reused = prepareReleaseManagedLinks(plan);
      assert.deepEqual(reused.created, []);
      assert.deepEqual(reused.reused, plan.managedLinks.map((entry) => entry.relativePath));
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'UNKNOWN'].includes(error.code)) {
        context.skip('Creating file symlinks is not permitted by this Windows environment');
        return;
      }
      throw error;
    }
    assert.deepEqual(inspectDependencyPublicationState(plan), {
      backend: 'reuse',
      'ui-server': 'reuse',
    });
    assert.equal(validatePreparedReleaseLinks(plan), true);
    const extraTarget = path.join(fixture.fixtureRoot, 'extra-target');
    mkdir(extraTarget);
    symlinkSync(extraTarget, path.join(fixture.releaseRoot, 'be/extra-link'), 'junction');
    assert.throws(() => validatePreparedReleaseLinks(plan), /managed-link inventory.*unexpected or missing/i);
  });
});
