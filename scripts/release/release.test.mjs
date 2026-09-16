import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { extractGitHubArtifact } from '../deploy/extract-github-artifact.mjs';
import {
  createGitHubReleaseEvidence,
  serializeGitHubReleaseEvidence,
} from '../deploy/github-release-evidence.mjs';
import {
  collectPayload,
  createReleaseManifest,
  createTarGzipBuffer,
  extractVerifiedReleaseArchive,
  packageRelease,
  parseStrictCliArguments,
  preflightPayloadTree,
  RELEASE_LIMITS,
  REQUIRED_PAYLOAD_FILES,
  serializeReleaseManifest,
  sha256,
  validatePayloadResourceSummary,
  validateReleaseEnvelopeResourceSummary,
  verifyReleaseArchive,
} from './lib.mjs';

const SOURCE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RELEASE_ID = 'omnilodge-r101-a2-aaaaaaaaaaaa';
const BUILT_AT = '2026-09-14T12:34:56.000Z';
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

const write = (root, relativePath, data) => {
  const destination = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, data);
};

const packageJson = (name) => `${JSON.stringify({
  name,
  version: '1.0.0',
  engines: { node: '22.23.2', npm: '10.9.8' },
  packageManager: 'npm@10.9.8',
}, null, 2)}\n`;

const makeFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'omnilodge-release-fixture-'));
  write(root, '.nvmrc', '22.23.2\n');
  for (const packageName of ['be', 'ui', 'ui-server']) {
    write(root, `${packageName}/package.json`, packageJson(packageName));
    write(root, `${packageName}/package-lock.json`, `{"lockfileVersion":3,"name":"${packageName}"}\n`);
  }
  write(root, 'be/dist/app.js', 'console.log("backend");\n');
  write(root, 'be/dist/migrations/example.js', 'export default {};\n');
  write(root, 'be/dist/scripts/baselineMigrations.js', 'export const adopt = false;\n');
  write(root, 'be/dist/scripts/runMigrations.js', 'export const run = true;\n');
  write(root, 'be/dist/scripts/syncAccessControl.js', 'export const sync = true;\n');
  write(root, 'be/scripts/startMonitored.js', 'await import("../dist/app.js");\n');
  write(root, 'ui/build/index.html', '<script src="/static/js/main.abc12345.js"></script>\n');
  write(root, 'ui/build/static/js/main.abc12345.js', `const RELEASE_ID=${JSON.stringify(RELEASE_ID)};console.log("ui");\n`);
  write(root, 'ui/build/static/js/main.abc12345.js.map', '{}\n');
  write(root, 'ui/build/asset-manifest.json', `${JSON.stringify({
    files: { 'main.js': '/static/js/main.abc12345.js' },
    entrypoints: ['static/js/main.abc12345.js'],
  }, null, 2)}\n`);
  write(root, 'ui/build/release-metadata.json', `${JSON.stringify({
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    gitSha: SOURCE_SHA,
  }, null, 2)}\n`);
  write(root, 'ui/build/service-worker.js', `const RELEASE_ID=${JSON.stringify(RELEASE_ID)};self.addEventListener("install",()=>{});\n`);
  write(root, 'ui/build/manifest.json', '{"name":"OmniLodge","start_url":"/","display":"standalone"}\n');
  write(root, 'ui/build/pwa-manifest-selector.js', 'document.documentElement.dataset.pwa="ready";\n');
  write(root, 'ui/public/assets/badges/ktk-guide-badge.svg', '<svg/>\n');
  write(root, 'ui/public/assets/badges/ktk-media-badge.svg', '<svg/>\n');
  write(root, 'ui/public/assets/badges/ktk-backside-badge.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const uiServerFiles = [
    'server.js',
    'reportingSecurity.js',
    'sourceMapArchive.js',
    'telemetryPayload.js',
    'telemetrySecurity.js',
    'health.js',
    'runtimeConfig.js',
    'uiArtifactValidation.js',
    'utils/logger.js',
  ];
  for (const relativePath of uiServerFiles) {
    write(root, `ui-server/${relativePath}`, `export const fixture = ${JSON.stringify(relativePath)};\n`);
  }
  return root;
};

const metadata = ({
  event = 'push',
  ref = 'refs/heads/master',
  repository = 'pablo-dryfield/omni-lodge',
  workflowPath = '.github/workflows/release.yml',
} = {}) => ({
  sourceSha: SOURCE_SHA,
  releaseId: RELEASE_ID,
  builtAtUtc: BUILT_AT,
  workflow: {
    repository,
    workflowName: 'Release',
    workflowPath,
    event,
    ref,
    headSha: SOURCE_SHA,
    runId: '101',
    runAttempt: '2',
    runNumber: '77',
    actor: 'release-bot',
    artifactName: RELEASE_ID,
  },
});

const productionEvidence = {
  workflowConclusion: 'success',
  artifactId: '987654321',
  artifactDigest: `sha256:${'c'.repeat(64)}`,
  expectedReleaseId: RELEASE_ID,
  expectedSourceSha: SOURCE_SHA,
  expectedRepository: 'pablo-dryfield/omni-lodge',
  expectedWorkflowPath: '.github/workflows/release.yml',
  expectedEvent: 'push',
  expectedRef: 'refs/heads/master',
  expectedRunId: '101',
  expectedRunAttempt: '2',
  expectedArtifactName: RELEASE_ID,
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const buildStoredGitHubArtifactZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);
    const flags = 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
};

const extractRawGitHubReleaseArtifact = async ({ fixture, release, stageName }) => {
  const artifactZip = buildStoredGitHubArtifactZip([
    { name: path.basename(release.archivePath), data: readFileSync(release.archivePath) },
    { name: path.basename(release.checksumPath), data: readFileSync(release.checksumPath) },
  ]);
  const artifactDigest = `sha256:${sha256(artifactZip)}`;
  const artifactId = '987654321';
  const repositoryId = 9001;
  const run = {
    id: 101,
    run_attempt: 2,
    path: '.github/workflows/release.yml',
    event: 'push',
    head_branch: 'master',
    head_sha: SOURCE_SHA,
    status: 'completed',
    conclusion: 'success',
    repository: { id: repositoryId, full_name: 'pablo-dryfield/omni-lodge' },
    head_repository: { id: repositoryId, full_name: 'pablo-dryfield/omni-lodge' },
  };
  const artifact = {
    id: Number(artifactId),
    name: RELEASE_ID,
    expired: false,
    digest: artifactDigest,
    workflow_run: {
      id: 101,
      repository_id: repositoryId,
      head_repository_id: repositoryId,
      head_branch: 'master',
      head_sha: SOURCE_SHA,
    },
  };
  const evidence = createGitHubReleaseEvidence({
    run,
    artifactsResponse: { total_count: 1, artifacts: [artifact] },
    expectedRunId: '101',
    expectedRunAttempt: '2',
    expectedSourceSha: SOURCE_SHA,
    expectedArtifactId: artifactId,
    configuredMode: 'disabled',
    trigger: 'manual',
    operation: 'dry-run',
  });
  const inputDirectory = path.join(fixture, `${stageName}-input`);
  mkdirSync(inputDirectory);
  const artifactZipPath = path.join(inputDirectory, 'artifact.zip');
  const evidencePath = path.join(inputDirectory, 'evidence.json');
  writeFileSync(artifactZipPath, artifactZip);
  writeFileSync(evidencePath, serializeGitHubReleaseEvidence(evidence));
  return extractGitHubArtifact({
    artifactZipPath,
    evidencePath,
    stagingDirectory: path.join(fixture, stageName),
  });
};

const packageCliArguments = (fixture, outputDir) => [
  path.join(SCRIPT_DIRECTORY, 'package.mjs'),
  '--repo-root', fixture,
  '--output-dir', outputDir,
  '--source-sha', SOURCE_SHA,
  '--built-at', BUILT_AT,
  '--repository', 'pablo-dryfield/omni-lodge',
  '--workflow-name', 'Release',
  '--workflow-path', '.github/workflows/release.yml',
  '--event', 'push',
  '--ref', 'refs/heads/master',
  '--run-id', '101',
  '--run-attempt', '2',
  '--run-number', '77',
  '--actor', 'release-bot',
];

const productionEvidenceCliArguments = () => [
  '--workflow-conclusion', 'success',
  '--artifact-id', productionEvidence.artifactId,
  '--artifact-digest', productionEvidence.artifactDigest,
  '--expected-release-id', RELEASE_ID,
  '--expected-source-sha', SOURCE_SHA,
  '--expected-repository', productionEvidence.expectedRepository,
  '--expected-workflow-path', productionEvidence.expectedWorkflowPath,
  '--expected-event', productionEvidence.expectedEvent,
  '--expected-ref', productionEvidence.expectedRef,
  '--expected-run-id', productionEvidence.expectedRunId,
  '--expected-run-attempt', productionEvidence.expectedRunAttempt,
  '--expected-artifact-name', productionEvidence.expectedArtifactName,
];

const spawnNode = (args, options = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => resolve({ status: null, stdout, stderr, error }));
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

const rewriteDetachedChecksum = (archivePath, checksumPath) => {
  const digest = sha256(readFileSync(archivePath));
  writeFileSync(checksumPath, `${digest}  ${path.basename(archivePath)}\n`);
};

const cloneManifest = (manifest) => JSON.parse(JSON.stringify(manifest));

const replacePayloadFile = (payload, manifest, filePath, data) => {
  const payloadFile = payload.find((file) => file.path === filePath);
  assert.ok(payloadFile, `Missing fixture payload file ${filePath}`);
  payloadFile.data = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const manifestFile = manifest.files.find((file) => file.path === filePath);
  assert.ok(manifestFile, `Missing fixture manifest file ${filePath}`);
  manifestFile.size = payloadFile.data.length;
  manifestFile.sha256 = sha256(payloadFile.data);
};

const writeCraftedArchive = ({ fixture, payload, manifest, manifestData, name = 'crafted' }) => {
  const outputDir = path.join(fixture, name);
  mkdirSync(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, `${manifest.releaseId}.tar.gz`);
  const checksumPath = `${archivePath}.sha256`;
  const archive = createTarGzipBuffer({
    rootName: manifest.releaseId,
    files: [
      ...payload,
      {
        path: 'release-manifest.json',
        data: manifestData ?? serializeReleaseManifest(manifest),
      },
    ],
  });
  writeFileSync(archivePath, archive);
  writeFileSync(checksumPath, `${sha256(archive)}  ${path.basename(archivePath)}\n`);
  return { archivePath, checksumPath };
};

const buildFixtureRelease = (fixture) => {
  const payload = collectPayload(fixture).map((file) => ({ ...file, data: Buffer.from(file.data) }));
  const manifest = createReleaseManifest({ repoRoot: fixture, payload, metadata: metadata() });
  return { payload, manifest: cloneManifest(manifest) };
};

const replaceTarFileContent = (archivePath, expected, replacement) => {
  assert.equal(Buffer.byteLength(expected), Buffer.byteLength(replacement));
  const tar = gunzipSync(readFileSync(archivePath));
  const index = tar.indexOf(Buffer.from(expected));
  assert.notEqual(index, -1);
  Buffer.from(replacement).copy(tar, index);
  const gzip = gzipSync(tar, { level: 9, mtime: 0 });
  gzip[9] = 255;
  writeFileSync(archivePath, gzip);
};

const rewriteTarPath = (archivePath, suffix, replacementPath) => {
  const tar = gunzipSync(readFileSync(archivePath));
  let offset = 0;
  let changed = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const nullIndex = header.subarray(0, 100).indexOf(0);
    const name = header.subarray(0, nullIndex === -1 ? 100 : nullIndex).toString('utf8');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (name.endsWith(suffix)) {
      assert.ok(Buffer.byteLength(replacementPath) <= 100);
      header.fill(0, 0, 100);
      Buffer.from(replacementPath).copy(header, 0);
      header.fill(0, 345, 500);
      header.fill(0x20, 148, 156);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      Buffer.from(`${checksum.toString(8).padStart(6, '0')}\0 `).copy(header, 148);
      changed = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(changed, true);
  const gzip = gzipSync(tar, { level: 9, mtime: 0 });
  gzip[9] = 255;
  writeFileSync(archivePath, gzip);
};

const rewriteTarType = (archivePath, suffix, typeByte) => {
  const tar = gunzipSync(readFileSync(archivePath));
  let offset = 0;
  let changed = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const nullIndex = header.subarray(0, 100).indexOf(0);
    const name = header.subarray(0, nullIndex === -1 ? 100 : nullIndex).toString('utf8');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (name.endsWith(suffix)) {
      header[156] = typeByte;
      header.fill(0x20, 148, 156);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      Buffer.from(`${checksum.toString(8).padStart(6, '0')}\0 `).copy(header, 148);
      changed = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(changed, true);
  const gzip = gzipSync(tar, { level: 9, mtime: 0 });
  gzip[9] = 255;
  writeFileSync(archivePath, gzip);
};

test('packages and verifies one deterministic, allowlisted release archive', () => {
  const fixture = makeFixture();
  try {
    const first = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output-a'), metadata: metadata() });
    const second = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output-b'), metadata: metadata() });
    assert.deepEqual(readFileSync(first.archivePath), readFileSync(second.archivePath));
    assert.equal(first.archiveSha256, second.archiveSha256);
    assert.equal(first.manifest.productionEligibility.candidate, true);
    assert.equal(first.manifest.mainUiAsset, 'ui/build/static/js/main.abc12345.js');
    assert.ok(first.manifest.files.some((file) => file.path === 'ui-server/runtimeConfig.js'));
    assert.ok(first.manifest.files.some((file) => file.path === 'ui/build/static/js/main.abc12345.js.map'));
    assert.ok(!first.manifest.files.some((file) => file.path === 'ui/package-lock.json'));

    const verified = verifyReleaseArchive({ archivePath: first.archivePath, checksumPath: first.checksumPath });
    assert.equal(verified.manifest.releaseId, RELEASE_ID);
    assert.equal(verified.payloadFileCount, first.manifest.fileCount);
    assert.equal(verified.productionCandidate, true);
  } finally {
    cleanup(fixture);
  }
});

const invalidUiMetadataCases = [
  {
    name: 'missing release metadata',
    mutate: (fixture) => rmSync(path.join(fixture, 'ui', 'build', 'release-metadata.json')),
    message: /Required release payload file is missing: ui\/build\/release-metadata\.json/,
  },
  {
    name: 'malformed release metadata',
    mutate: (fixture) => write(fixture, 'ui/build/release-metadata.json', '{not-json'),
    message: /release-metadata\.json must contain valid JSON/,
  },
  {
    name: 'wrong release ID',
    mutate: (fixture) => write(fixture, 'ui/build/release-metadata.json', `${JSON.stringify({
      schemaVersion: 1,
      releaseId: 'omnilodge-r101-a2-bbbbbbbbbbbb',
      gitSha: SOURCE_SHA,
    })}\n`),
    message: /releaseId does not match the release manifest/,
  },
  {
    name: 'wrong source SHA',
    mutate: (fixture) => write(fixture, 'ui/build/release-metadata.json', `${JSON.stringify({
      schemaVersion: 1,
      releaseId: RELEASE_ID,
      gitSha: 'b'.repeat(40),
    })}\n`),
    message: /gitSha does not match the release manifest/,
  },
  {
    name: 'uppercase source SHA',
    mutate: (fixture) => write(fixture, 'ui/build/release-metadata.json', `${JSON.stringify({
      schemaVersion: 1,
      releaseId: RELEASE_ID,
      gitSha: SOURCE_SHA.toUpperCase(),
    })}\n`),
    message: /gitSha must be a full lowercase Git SHA/,
  },
  {
    name: 'unexpected metadata key',
    mutate: (fixture) => write(fixture, 'ui/build/release-metadata.json', `${JSON.stringify({
      schemaVersion: 1,
      releaseId: RELEASE_ID,
      gitSha: SOURCE_SHA,
      unreviewed: true,
    })}\n`),
    message: /unexpected or missing fields/,
  },
  {
    name: 'unsupported metadata schema',
    mutate: (fixture) => write(fixture, 'ui/build/release-metadata.json', `${JSON.stringify({
      schemaVersion: 2,
      releaseId: RELEASE_ID,
      gitSha: SOURCE_SHA,
    })}\n`),
    message: /schemaVersion must be 1/,
  },
];

for (const invalidCase of invalidUiMetadataCases) {
  test(`packaging rejects ${invalidCase.name}`, () => {
    const fixture = makeFixture();
    try {
      invalidCase.mutate(fixture);
      assert.throws(
        () => packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() }),
        invalidCase.message,
      );
    } finally {
      cleanup(fixture);
    }
  });
}

for (const asset of [
  ['main bundle', 'ui/build/static/js/main.abc12345.js', 'console.log("no release");\n'],
  ['service worker', 'ui/build/service-worker.js', 'self.addEventListener("install",()=>{});\n'],
]) {
  test(`packaging requires the ${asset[0]} to embed the exact release ID`, () => {
    const fixture = makeFixture();
    try {
      write(fixture, asset[1], asset[2]);
      assert.throws(
        () => packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() }),
        /does not embed releaseId as an exact JavaScript string literal/,
      );
    } finally {
      cleanup(fixture);
    }
  });
}

test('requires authenticated workflow and immutable artifact evidence for production verification', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    assert.throws(
      () => verifyReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        requireProductionEligible: true,
      }),
      /Authenticated production provenance evidence is required/,
    );
    const verified = verifyReleaseArchive({
      archivePath: release.archivePath,
      checksumPath: release.checksumPath,
      requireProductionEligible: true,
      productionEvidence,
    });
    assert.equal(verified.productionCandidate, true);
  } finally {
    cleanup(fixture);
  }
});

test('production extraction verifies and writes the exact release without overwriting', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    const extracted = extractVerifiedReleaseArchive({
      archivePath: release.archivePath,
      checksumPath: release.checksumPath,
      expectedArchiveSha256: release.archiveSha256,
      releasesDirectory,
      requireProductionEligible: true,
      productionEvidence,
    });
    const expectedDestination = path.join(releasesDirectory, RELEASE_ID);
    assert.equal(extracted.destinationPath, expectedDestination);
    assert.equal(
      readFileSync(path.join(expectedDestination, 'be', 'dist', 'app.js'), 'utf8'),
      readFileSync(path.join(fixture, 'be', 'dist', 'app.js'), 'utf8'),
    );
    assert.equal(existsSync(path.join(expectedDestination, 'release-manifest.json')), true);
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory,
        requireProductionEligible: true,
        productionEvidence,
      }),
      /Release directory already exists/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('raw GitHub artifact extraction binds the trusted inner hash into release extraction', async () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({
      repoRoot: fixture,
      outputDir: path.join(fixture, 'output'),
      metadata: metadata(),
    });
    const handoff = await extractRawGitHubReleaseArtifact({
      fixture,
      release,
      stageName: 'github-stage-success',
    });
    assert.equal(handoff.archiveSha256, release.archiveSha256);
    assert.notEqual(handoff.archiveSha256, handoff.artifactZipSha256);

    const releasesDirectory = path.join(fixture, 'releases-from-github');
    mkdirSync(releasesDirectory);
    const extracted = extractVerifiedReleaseArchive({
      archivePath: handoff.archivePath,
      checksumPath: handoff.checksumPath,
      expectedArchiveSha256: handoff.archiveSha256,
      releasesDirectory,
      productionEvidence: handoff.productionEvidence,
    });
    assert.equal(extracted.archiveSha256, handoff.archiveSha256);
    assert.equal(extracted.destinationPath, path.join(releasesDirectory, RELEASE_ID));
  } finally {
    cleanup(fixture);
  }
});

test('release extraction rejects a self-consistent replacement after raw artifact verification', async () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({
      repoRoot: fixture,
      outputDir: path.join(fixture, 'output'),
      metadata: metadata(),
    });
    const handoff = await extractRawGitHubReleaseArtifact({
      fixture,
      release,
      stageName: 'github-stage-replaced',
    });
    const originalTrustedArchiveSha256 = handoff.archiveSha256;

    const altered = buildFixtureRelease(fixture);
    replacePayloadFile(
      altered.payload,
      altered.manifest,
      'be/dist/app.js',
      'console.log("different but canonical backend");\n',
    );
    const replacement = writeCraftedArchive({
      fixture,
      payload: altered.payload,
      manifest: altered.manifest,
      name: 'self-consistent-replacement',
    });
    const replacementBytes = readFileSync(replacement.archivePath);
    const replacementSha256 = sha256(replacementBytes);
    assert.notEqual(replacementSha256, originalTrustedArchiveSha256);
    writeFileSync(handoff.archivePath, replacementBytes);
    writeFileSync(
      handoff.checksumPath,
      `${replacementSha256}  ${path.basename(handoff.archivePath)}\n`,
    );

    const selfConsistentReplacement = verifyReleaseArchive({
      archivePath: handoff.archivePath,
      checksumPath: handoff.checksumPath,
      requireProductionEligible: true,
      productionEvidence: handoff.productionEvidence,
    });
    assert.equal(selfConsistentReplacement.archiveSha256, replacementSha256);

    const releasesDirectory = path.join(fixture, 'releases-reject-replacement');
    mkdirSync(releasesDirectory);
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: handoff.archivePath,
        checksumPath: handoff.checksumPath,
        expectedArchiveSha256: originalTrustedArchiveSha256,
        releasesDirectory,
        productionEvidence: handoff.productionEvidence,
      }),
      /does not match the trusted expected archive SHA-256/,
    );
    assert.deepEqual(readdirSync(releasesDirectory), []);
  } finally {
    cleanup(fixture);
  }
});

test('production extraction leaves no partial directory when verification fails', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const archive = readFileSync(release.archivePath);
    archive[archive.length - 1] ^= 0xff;
    writeFileSync(release.archivePath, archive);
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory,
        requireProductionEligible: true,
        productionEvidence,
      }),
      /does not match the trusted expected archive SHA-256/,
    );
    assert.deepEqual(readdirSync(releasesDirectory), []);
  } finally {
    cleanup(fixture);
  }
});

test('production extraction cannot disable or omit production authorization', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory,
        requireProductionEligible: false,
        productionEvidence,
      }),
      /cannot disable production eligibility verification/,
    );
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory,
      }),
      /Authenticated production provenance evidence is required/,
    );
    assert.deepEqual(readdirSync(releasesDirectory), []);
  } finally {
    cleanup(fixture);
  }
});

test('production extraction requires and binds a trusted inner archive SHA-256', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({
      repoRoot: fixture,
      outputDir: path.join(fixture, 'output'),
      metadata: metadata(),
    });
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    const base = {
      archivePath: release.archivePath,
      checksumPath: release.checksumPath,
      releasesDirectory,
      productionEvidence,
    };
    for (const expectedArchiveSha256 of [
      undefined,
      release.archiveSha256.toUpperCase(),
      release.archiveSha256.slice(1),
    ]) {
      assert.throws(
        () => extractVerifiedReleaseArchive({ ...base, expectedArchiveSha256 }),
        /Trusted expected release archive SHA-256 is required/,
      );
    }
    assert.throws(
      () => extractVerifiedReleaseArchive({
        ...base,
        expectedArchiveSha256: '0'.repeat(64),
      }),
      /does not match the trusted expected archive SHA-256/,
    );
    assert.deepEqual(readdirSync(releasesDirectory), []);
  } finally {
    cleanup(fixture);
  }
});

for (const [targetName, targetPathFromRelease, fillByte, expectedFailure] of [
  ['archive', (release) => release.archivePath, 0x5a, /Release archive metadata changed while being read/],
  ['checksum', (release) => release.checksumPath, 0x30, /Detached checksum metadata changed while being read/],
]) {
  test(`release verification holds the opened ${targetName} descriptor across a path swap`, (context) => {
    const fixture = makeFixture();
    const originalReadSync = fs.readSync;
    let builtinsPatched = false;
    try {
      const release = packageRelease({
        repoRoot: fixture,
        outputDir: path.join(fixture, 'output'),
        metadata: metadata(),
      });
      const targetPath = targetPathFromRelease(release);
      const originalTarget = readFileSync(targetPath);
      const movedTargetPath = `${targetPath}.opened`;
      let swapped = false;
      let swapUnavailable = null;

      fs.readSync = (...arguments_) => {
        const descriptor = arguments_[0];
        const descriptorSize = Number(fs.fstatSync(descriptor, { bigint: true }).size);
        if (!swapped && descriptorSize === originalTarget.length) {
          try {
            renameSync(targetPath, movedTargetPath);
            writeFileSync(targetPath, Buffer.alloc(originalTarget.length, fillByte));
            swapped = true;
          } catch (error) {
            if (error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES')) {
              swapUnavailable = error.code;
            } else {
              throw error;
            }
          }
        }
        return originalReadSync(...arguments_);
      };
      syncBuiltinESMExports();
      builtinsPatched = true;

      const releasesDirectory = path.join(fixture, `releases-${targetName}-descriptor-swap`);
      mkdirSync(releasesDirectory);
      let extracted = null;
      let verificationError = null;
      try {
        extracted = extractVerifiedReleaseArchive({
          archivePath: release.archivePath,
          checksumPath: release.checksumPath,
          expectedArchiveSha256: release.archiveSha256,
          releasesDirectory,
          productionEvidence,
        });
      } catch (error) {
        verificationError = error;
      }
      if (swapUnavailable) {
        context.skip(`Open-file path replacement is unavailable: ${swapUnavailable}`);
        return;
      }
      assert.equal(swapped, true);
      if (verificationError) {
        assert.match(verificationError.message, expectedFailure);
      } else {
        assert.equal(extracted.archiveSha256, release.archiveSha256);
      }
    } finally {
      if (builtinsPatched) {
        fs.readSync = originalReadSync;
        syncBuiltinESMExports();
      }
      cleanup(fixture);
    }
  });
}

test('failed release extraction preserves partial residue and its reservation', () => {
  const fixture = makeFixture();
  const originalWriteFileSync = fs.writeFileSync;
  let builtinsPatched = false;
  try {
    const release = packageRelease({
      repoRoot: fixture,
      outputDir: path.join(fixture, 'output'),
      metadata: metadata(),
    });
    const releasesDirectory = path.join(fixture, 'releases-preserved-residue');
    mkdirSync(releasesDirectory);
    let injected = false;
    fs.writeFileSync = (target, ...arguments_) => {
      if (!injected && typeof target === 'number') {
        injected = true;
        const error = new Error('injected extraction write failure');
        error.code = 'EIO';
        throw error;
      }
      return originalWriteFileSync(target, ...arguments_);
    };
    syncBuiltinESMExports();
    builtinsPatched = true;

    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory,
        productionEvidence,
      }),
      /injected extraction write failure.*Partial extraction residue was preserved.*reservation was retained/,
    );
    assert.equal(injected, true);
    const residue = readdirSync(releasesDirectory).sort();
    assert.equal(residue.some((entry) => entry.startsWith(`.extract-${RELEASE_ID}-`)), true);
    assert.equal(residue.includes(`.reserve-${RELEASE_ID}`), true);
    assert.equal(residue.includes(RELEASE_ID), false);
  } finally {
    if (builtinsPatched) {
      fs.writeFileSync = originalWriteFileSync;
      syncBuiltinESMExports();
    }
    cleanup(fixture);
  }
});

test('a competing extraction reservation is preserved and rejected', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    const reservationPath = path.join(releasesDirectory, `.reserve-${RELEASE_ID}`);
    writeFileSync(reservationPath, 'owned by another deployment\n');
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory,
        productionEvidence,
      }),
      /extraction reservation failed/,
    );
    assert.equal(readFileSync(reservationPath, 'utf8'), 'owned by another deployment\n');
    assert.deepEqual(readdirSync(releasesDirectory), [`.reserve-${RELEASE_ID}`]);
  } finally {
    cleanup(fixture);
  }
});

test('production extraction rejects a symbolic-link release root', (context) => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const realReleasesDirectory = path.join(fixture, 'releases-real');
    const linkedReleasesDirectory = path.join(fixture, 'releases-linked');
    mkdirSync(realReleasesDirectory);
    try {
      symlinkSync(
        realReleasesDirectory,
        linkedReleasesDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES')) {
        context.skip(`Symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => extractVerifiedReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        expectedArchiveSha256: release.archiveSha256,
        releasesDirectory: linkedReleasesDirectory,
        productionEvidence,
      }),
      /extraction root must be a real directory|resolves through a symbolic link or junction/,
    );
    assert.deepEqual(readdirSync(realReleasesDirectory), []);
  } finally {
    cleanup(fixture);
  }
});

test('production extraction applies explicit release file and directory modes', (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX mode assertions do not apply on Windows');
    return;
  }
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    const extracted = extractVerifiedReleaseArchive({
      archivePath: release.archivePath,
      checksumPath: release.checksumPath,
      expectedArchiveSha256: release.archiveSha256,
      releasesDirectory,
      productionEvidence,
    });
    assert.equal(statSync(extracted.destinationPath).mode & 0o777, 0o755);
    assert.equal(statSync(path.join(extracted.destinationPath, 'be', 'dist')).mode & 0o777, 0o755);
    assert.equal(statSync(path.join(extracted.destinationPath, 'be', 'dist', 'app.js')).mode & 0o777, 0o644);
  } finally {
    cleanup(fixture);
  }
});

for (const [field, value, message] of [
  ['expectedReleaseId', 'omnilodge-r102-a1-bbbbbbbbbbbb', /Expected release ID does not match/],
  ['expectedSourceSha', 'b'.repeat(40), /Expected source SHA does not match/],
  ['expectedRepository', 'someone-else/omni-lodge', /Expected repository does not match/],
  ['expectedWorkflowPath', '.github/workflows/not-release.yml', /Expected workflow path does not match/],
  ['expectedEvent', 'pull_request', /Expected workflow event does not match/],
  ['expectedRef', 'refs/heads/not-master', /Expected workflow ref does not match/],
  ['expectedRunId', '102', /Expected workflow run ID does not match/],
  ['expectedRunAttempt', '3', /Expected workflow run attempt does not match/],
  ['expectedArtifactName', 'different-artifact', /Expected artifact name does not match/],
]) {
  test(`production verification independently matches ${field}`, () => {
    const fixture = makeFixture();
    try {
      const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
      assert.throws(
        () => verifyReleaseArchive({
          archivePath: release.archivePath,
          checksumPath: release.checksumPath,
          requireProductionEligible: true,
          productionEvidence: { ...productionEvidence, [field]: value },
        }),
        message,
      );
    } finally {
      cleanup(fixture);
    }
  });
}

for (const [field, value, message] of [
  ['workflowConclusion', 'failure', /originating workflow must have concluded successfully/],
  ['artifactId', 'not-an-id', /immutable GitHub artifact ID is required/],
  ['artifactDigest', `sha512:${'c'.repeat(64)}`, /authenticated lowercase SHA-256 GitHub artifact digest is required/],
  ['artifactDigest', `sha256:${'C'.repeat(64)}`, /authenticated lowercase SHA-256 GitHub artifact digest is required/],
  ['expectedSourceSha', SOURCE_SHA.toUpperCase(), /Expected source SHA must be a full lowercase Git SHA/],
]) {
  test(`production verification rejects invalid authenticated ${field}`, () => {
    const fixture = makeFixture();
    try {
      const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
      assert.throws(
        () => verifyReleaseArchive({
          archivePath: release.archivePath,
          checksumPath: release.checksumPath,
          requireProductionEligible: true,
          productionEvidence: { ...productionEvidence, [field]: value },
        }),
        message,
      );
    } finally {
      cleanup(fixture);
    }
  });
}

test('branch and pull-request artifacts cannot pass production eligibility', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({
      repoRoot: fixture,
      outputDir: path.join(fixture, 'output'),
      metadata: metadata({ event: 'pull_request', ref: 'refs/pull/12/merge' }),
    });
    assert.equal(release.manifest.productionEligibility.candidate, false);
    assert.deepEqual(release.manifest.productionEligibility.reasons, ['event_not_push', 'ref_not_master']);
    assert.throws(
      () => verifyReleaseArchive({
        archivePath: release.archivePath,
        checksumPath: release.checksumPath,
        requireProductionEligible: true,
        productionEvidence,
      }),
      /Artifact is not production-eligible/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('detects a changed archive through its detached checksum', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const archive = readFileSync(release.archivePath);
    archive[archive.length - 1] ^= 0xff;
    writeFileSync(release.archivePath, archive);
    assert.throws(
      () => verifyReleaseArchive({ archivePath: release.archivePath, checksumPath: release.checksumPath }),
      /Detached release archive checksum does not match/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('detects a changed payload even when the detached archive checksum is recomputed', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    replaceTarFileContent(release.archivePath, 'console.log("backend");', 'console.log("backXnd");');
    rewriteDetachedChecksum(release.archivePath, release.checksumPath);
    assert.throws(
      () => verifyReleaseArchive({ archivePath: release.archivePath, checksumPath: release.checksumPath }),
      /Release payload hash mismatch: be\/dist\/app.js/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('verifier rejects omission of every fixed runtime file and required entrypoint', () => {
  const fixture = makeFixture();
  try {
    const baseline = buildFixtureRelease(fixture);
    REQUIRED_PAYLOAD_FILES.forEach((requiredPath, index) => {
      const payload = baseline.payload
        .filter((file) => file.path !== requiredPath)
        .map((file) => ({ ...file, data: Buffer.from(file.data) }));
      const manifest = cloneManifest(baseline.manifest);
      manifest.files = manifest.files.filter((file) => file.path !== requiredPath);
      manifest.fileCount = manifest.files.length;
      const crafted = writeCraftedArchive({ fixture, payload, manifest, name: `omission-${index}` });
      assert.throws(
        () => verifyReleaseArchive(crafted),
        (error) => error instanceof Error
          && error.message.includes(`Required release payload file is missing: ${requiredPath}`),
        `Verifier accepted an archive without ${requiredPath}`,
      );
    });
  } finally {
    cleanup(fixture);
  }
});

const invalidArchivedMetadataCases = [
  ['malformed metadata', '{not-json', /must contain valid JSON/],
  ['wrong release ID', JSON.stringify({
    schemaVersion: 1,
    releaseId: 'omnilodge-r101-a2-bbbbbbbbbbbb',
    gitSha: SOURCE_SHA,
  }), /releaseId does not match the release manifest/],
  ['wrong source SHA', JSON.stringify({
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    gitSha: 'b'.repeat(40),
  }), /gitSha does not match the release manifest/],
  ['uppercase source SHA', JSON.stringify({
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    gitSha: SOURCE_SHA.toUpperCase(),
  }), /gitSha must be a full lowercase Git SHA/],
  ['an unexpected key', JSON.stringify({
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    gitSha: SOURCE_SHA,
    unreviewed: true,
  }), /unexpected or missing fields/],
  ['an unsupported schema', JSON.stringify({
    schemaVersion: 2,
    releaseId: RELEASE_ID,
    gitSha: SOURCE_SHA,
  }), /schemaVersion must be 1/],
];

for (const [label, metadataContents, expectedError] of invalidArchivedMetadataCases) {
  test(`verifier rejects ${label} after all affected hashes are recomputed`, () => {
    const fixture = makeFixture();
    try {
      const { payload, manifest } = buildFixtureRelease(fixture);
      replacePayloadFile(payload, manifest, 'ui/build/release-metadata.json', `${metadataContents}\n`);
      const crafted = writeCraftedArchive({
        fixture,
        payload,
        manifest,
        name: `metadata-${label.replaceAll(' ', '-')}`,
      });
      assert.throws(() => verifyReleaseArchive(crafted), expectedError);
    } finally {
      cleanup(fixture);
    }
  });
}

for (const [label, filePath, replacement] of [
  ['main bundle', 'ui/build/static/js/main.abc12345.js', 'const RELEASE_ID="omnilodge-r101-a2-bbbbbbbbbbbb";console.log("ui");\n'],
  ['service worker', 'ui/build/service-worker.js', 'const RELEASE_ID="omnilodge-r101-a2-bbbbbbbbbbbb";self.addEventListener("install",()=>{});\n'],
]) {
  test(`verifier semantically binds the release ID embedded in the ${label}`, () => {
    const fixture = makeFixture();
    try {
      const { payload, manifest } = buildFixtureRelease(fixture);
      replacePayloadFile(payload, manifest, filePath, replacement);
      const crafted = writeCraftedArchive({ fixture, payload, manifest, name: `${label.replace(' ', '-')}-tamper` });
      assert.throws(
        () => verifyReleaseArchive(crafted),
        /does not embed releaseId as an exact JavaScript string literal/,
      );
    } finally {
      cleanup(fixture);
    }
  });
}

test('rejects path traversal before extracting any archive content', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    rewriteTarPath(release.archivePath, 'be/dist/app.js', `${RELEASE_ID}/../escape.js`);
    rewriteDetachedChecksum(release.archivePath, release.checksumPath);
    assert.throws(
      () => verifyReleaseArchive({ archivePath: release.archivePath, checksumPath: release.checksumPath }),
      /unsafe path segment/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('rejects symbolic links before extracting any archive content', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    rewriteTarType(release.archivePath, 'be/dist/app.js', 0x32);
    rewriteDetachedChecksum(release.archivePath, release.checksumPath);
    assert.throws(
      () => verifyReleaseArchive({ archivePath: release.archivePath, checksumPath: release.checksumPath }),
      /link or unsupported tar entry/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('rejects a semantically equivalent archive that is not byte-canonical', () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const tar = gunzipSync(readFileSync(release.archivePath));
    const recompressed = gzipSync(tar, { level: 6, mtime: 0 });
    recompressed[9] = 255;
    writeFileSync(release.archivePath, recompressed);
    rewriteDetachedChecksum(release.archivePath, release.checksumPath);
    assert.throws(
      () => verifyReleaseArchive({ archivePath: release.archivePath, checksumPath: release.checksumPath }),
      /not in canonical deterministic form/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('refuses sensitive files even when they are placed inside an allowed build tree', () => {
  const fixture = makeFixture();
  try {
    write(fixture, 'ui/build/.env.production', 'SECRET=value\n');
    assert.throws(
      () => packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() }),
      /Environment files cannot be shipped/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('refuses to overwrite an existing immutable release', () => {
  const fixture = makeFixture();
  try {
    const outputDir = path.join(fixture, 'output');
    packageRelease({ repoRoot: fixture, outputDir, metadata: metadata() });
    assert.throws(
      () => packageRelease({ repoRoot: fixture, outputDir, metadata: metadata() }),
      /Refusing to overwrite immutable release output/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('refuses to write release output inside an included payload tree', () => {
  const fixture = makeFixture();
  try {
    assert.throws(
      () => packageRelease({
        repoRoot: fixture,
        outputDir: path.join(fixture, 'ui', 'build', 'release-output'),
        metadata: metadata(),
      }),
      /cannot overlap an included payload tree/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('refuses an output directory that contains an included payload tree', () => {
  const fixture = makeFixture();
  try {
    assert.throws(
      () => packageRelease({ repoRoot: fixture, outputDir: fixture, metadata: metadata() }),
      /cannot overlap an included payload tree/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('package and verify command-line entry points compose without package scripts', () => {
  const fixture = makeFixture();
  try {
    const outputDir = path.join(fixture, 'output');
    const packageResult = spawnSync(process.execPath, [
      path.join(SCRIPT_DIRECTORY, 'package.mjs'),
      '--repo-root', fixture,
      '--output-dir', outputDir,
      '--source-sha', SOURCE_SHA,
      '--built-at', BUILT_AT,
      '--repository', 'pablo-dryfield/omni-lodge',
      '--workflow-name', 'Release',
      '--workflow-path', '.github/workflows/release.yml',
      '--event', 'push',
      '--ref', 'refs/heads/master',
      '--run-id', '101',
      '--run-attempt', '2',
      '--run-number', '77',
      '--actor', 'release-bot',
    ], { encoding: 'utf8' });
    assert.equal(packageResult.status, 0, packageResult.stderr);
    const packaged = JSON.parse(packageResult.stdout);
    assert.equal(packaged.releaseId, RELEASE_ID);
    assert.equal(packaged.productionCandidate, true);

    const verifyResult = spawnSync(process.execPath, [
      path.join(SCRIPT_DIRECTORY, 'verify.mjs'),
      '--archive', packaged.archivePath,
    ], { encoding: 'utf8' });
    assert.equal(verifyResult.status, 0, verifyResult.stderr);
    const verified = JSON.parse(verifyResult.stdout);
    assert.equal(verified.verified, true);
    assert.equal(verified.archiveSha256, packaged.archiveSha256);

    const productionVerifyResult = spawnSync(process.execPath, [
      path.join(SCRIPT_DIRECTORY, 'verify.mjs'),
      '--archive', packaged.archivePath,
      '--require-production-eligible',
      '--workflow-conclusion', 'success',
      '--artifact-id', '987654321',
      '--artifact-digest', productionEvidence.artifactDigest,
      '--expected-release-id', RELEASE_ID,
      '--expected-source-sha', SOURCE_SHA,
      '--expected-repository', 'pablo-dryfield/omni-lodge',
      '--expected-workflow-path', '.github/workflows/release.yml',
      '--expected-event', 'push',
      '--expected-ref', 'refs/heads/master',
      '--expected-run-id', '101',
      '--expected-run-attempt', '2',
      '--expected-artifact-name', RELEASE_ID,
    ], { encoding: 'utf8' });
    assert.equal(productionVerifyResult.status, 0, productionVerifyResult.stderr);
    assert.equal(JSON.parse(productionVerifyResult.stdout).productionEligibilityVerified, true);

    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    const missingExpectedHash = spawnSync(process.execPath, [
      path.join(SCRIPT_DIRECTORY, 'extract.mjs'),
      '--archive', packaged.archivePath,
      '--releases-directory', releasesDirectory,
      ...productionEvidenceCliArguments(),
    ], { encoding: 'utf8' });
    assert.notEqual(missingExpectedHash.status, 0);
    assert.equal(missingExpectedHash.stdout, '');
    assert.match(missingExpectedHash.stderr, /--expected-archive-sha256 is required/);

    const extractionResult = spawnSync(process.execPath, [
      path.join(SCRIPT_DIRECTORY, 'extract.mjs'),
      '--archive', packaged.archivePath,
      '--expected-archive-sha256', packaged.archiveSha256,
      '--releases-directory', releasesDirectory,
      ...productionEvidenceCliArguments(),
    ], { encoding: 'utf8' });
    assert.equal(extractionResult.status, 0, extractionResult.stderr);
    const extraction = JSON.parse(extractionResult.stdout);
    assert.equal(extraction.extracted, true);
    assert.equal(extraction.releaseId, RELEASE_ID);
    assert.deepEqual(extraction.warnings, []);
  } finally {
    cleanup(fixture);
  }
});

test('strict CLI parsing rejects unknown, duplicate, equals-style, positional, and missing-value arguments', () => {
  const options = { valueOptions: ['archive'], booleanOptions: ['require-production-eligible'] };
  assert.deepEqual(
    parseStrictCliArguments(['--archive', 'release.tar.gz', '--require-production-eligible'], options),
    { values: { archive: 'release.tar.gz' }, flags: new Set(['require-production-eligible']) },
  );
  assert.throws(() => parseStrictCliArguments(['--unknown', 'value'], options), /Unknown CLI option/);
  assert.throws(
    () => parseStrictCliArguments(['--archive', 'one', '--archive', 'two'], options),
    /Duplicate CLI option/,
  );
  assert.throws(() => parseStrictCliArguments(['--archive=release.tar.gz'], options), /Equals-style CLI arguments/);
  assert.throws(() => parseStrictCliArguments(['release.tar.gz'], options), /Unexpected argument/);
  assert.throws(() => parseStrictCliArguments(['--archive'], options), /Missing value/);
  assert.throws(
    () => parseStrictCliArguments(['--require-production-eligible', '--require-production-eligible'], options),
    /Duplicate CLI option/,
  );
});

for (const [scriptName, label, args, expectedError] of [
  ['package.mjs', 'equals-style values', ['--output-dir=release-output'], /Equals-style CLI arguments/],
  ['verify.mjs', 'duplicate options', ['--archive', 'one', '--archive', 'two'], /Duplicate CLI option/],
  ['preflight.mjs', 'unknown options', ['--path', 'be/dist', '--surprise', 'value'], /Unknown CLI option/],
  ['verify.mjs', 'production evidence without its gate', ['--archive', 'one', '--artifact-id', '123'], /Production evidence options require/],
]) {
  test(`${scriptName} rejects ${label}`, () => {
    const result = spawnSync(process.execPath, [path.join(SCRIPT_DIRECTORY, scriptName), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expectedError);
  });
}

test('preflight validates each producer tree before upload', () => {
  const fixture = makeFixture();
  try {
    const backend = preflightPayloadTree({ repoRoot: fixture, relativePath: 'be/dist' });
    const ui = preflightPayloadTree({ repoRoot: fixture, relativePath: 'ui/build' });
    assert.equal(backend.path, 'be/dist');
    assert.ok(backend.fileCount >= 4);
    assert.equal(ui.path, 'ui/build');
    assert.ok(ui.fileCount >= 7);

    const cliResult = spawnSync(process.execPath, [
      path.join(SCRIPT_DIRECTORY, 'preflight.mjs'),
      '--path', 'ui/build',
    ], { cwd: fixture, encoding: 'utf8' });
    assert.equal(cliResult.status, 0, cliResult.stderr);
    assert.equal(JSON.parse(cliResult.stdout).preflightPassed, true);
  } finally {
    cleanup(fixture);
  }
});

test('preflight rejects unsupported roots and missing producer entrypoints', () => {
  const fixture = makeFixture();
  try {
    assert.throws(
      () => preflightPayloadTree({ repoRoot: fixture, relativePath: 'be' }),
      /Unsupported preflight payload root/,
    );
    rmSync(path.join(fixture, 'ui', 'build', 'service-worker.js'));
    assert.throws(
      () => preflightPayloadTree({ repoRoot: fixture, relativePath: 'ui/build' }),
      /Required release payload file is missing: ui\/build\/service-worker\.js/,
    );
  } finally {
    cleanup(fixture);
  }
});

for (const [label, relativePath] of [
  ['cloud credential directory', 'be/dist/.aws/credentials'],
  ['client secret JSON', 'ui/build/client_secret-production.json'],
  ['SSH private key name', 'be/dist/id_ed25519'],
  ['private-key extension', 'ui/build/signing.pem'],
  ['database state', 'be/dist/local.sqlite3'],
  ['backup file', 'ui/build/config.backup'],
]) {
  test(`preflight rejects ${label}`, () => {
    const fixture = makeFixture();
    try {
      write(fixture, relativePath, 'sensitive\n');
      const tree = relativePath.startsWith('be/') ? 'be/dist' : 'ui/build';
      assert.throws(
        () => preflightPayloadTree({ repoRoot: fixture, relativePath: tree }),
        /Sensitive|Credential|Environment/,
      );
    } finally {
      cleanup(fixture);
    }
  });
}

test('source traversal rejects a symbolic-link ancestor even when its target remains in the repository', (context) => {
  const fixture = makeFixture();
  try {
    const original = path.join(fixture, 'be', 'dist', 'migrations');
    const target = path.join(fixture, 'be', 'linked-migrations');
    renameSync(original, target);
    try {
      symlinkSync(target, original, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES')) {
        context.skip(`Symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => preflightPayloadTree({ repoRoot: fixture, relativePath: 'be/dist' }),
      /Symbolic links|symbolic link or junction/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('packaging rejects an output path with a symbolic-link ancestor', (context) => {
  const fixture = makeFixture();
  try {
    const target = path.join(fixture, 'output-real');
    const linked = path.join(fixture, 'output-linked');
    mkdirSync(target);
    try {
      symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES')) {
        context.skip(`Symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => packageRelease({ repoRoot: fixture, outputDir: path.join(linked, 'release'), metadata: metadata() }),
      /output ancestor must be a real directory|output directory or one of its ancestors resolves through a symbolic link/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('verification rejects archive paths reached through a symbolic-link ancestor', (context) => {
  const fixture = makeFixture();
  try {
    const output = path.join(fixture, 'output-real');
    const release = packageRelease({ repoRoot: fixture, outputDir: output, metadata: metadata() });
    const linked = path.join(fixture, 'output-linked');
    try {
      symlinkSync(output, linked, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES')) {
        context.skip(`Symlink creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => verifyReleaseArchive({
        archivePath: path.join(linked, path.basename(release.archivePath)),
        checksumPath: path.join(linked, path.basename(release.checksumPath)),
      }),
      /ancestors resolves through a symbolic link or junction/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('resource limits accept exact boundaries and reject one unit over', () => {
  assert.deepEqual(RELEASE_LIMITS, {
    maxPayloadFileBytes: 128 * 1024 * 1024,
    maxPayloadFileCount: 20_000,
    maxPayloadTotalBytes: 512 * 1024 * 1024,
    maxManifestBytes: 8 * 1024 * 1024,
    maxUncompressedArchiveBytes: 576 * 1024 * 1024,
    maxCompressedArchiveBytes: 512 * 1024 * 1024,
    maxArchiveEntries: 100_000,
  });

  const exactTotal = Array.from({ length: 4 }, (_, index) => ({
    path: `be/dist/boundary-${index}.bin`,
    size: RELEASE_LIMITS.maxPayloadFileBytes,
  }));
  assert.deepEqual(validatePayloadResourceSummary(exactTotal), {
    fileCount: 4,
    totalBytes: RELEASE_LIMITS.maxPayloadTotalBytes,
  });
  assert.throws(
    () => validatePayloadResourceSummary([{ path: 'be/dist/too-large.bin', size: RELEASE_LIMITS.maxPayloadFileBytes + 1 }]),
    /payload file exceeds/,
  );
  assert.throws(
    () => validatePayloadResourceSummary([...exactTotal, { path: 'be/dist/one-more-byte.bin', size: 1 }]),
    /payload exceeds.*total limit/,
  );

  const exactCount = Array.from({ length: RELEASE_LIMITS.maxPayloadFileCount }, (_, index) => ({
    path: `be/dist/count-${index}.js`,
    size: 0,
  }));
  assert.equal(validatePayloadResourceSummary(exactCount).fileCount, RELEASE_LIMITS.maxPayloadFileCount);
  assert.throws(
    () => validatePayloadResourceSummary([...exactCount, { path: 'be/dist/count-over.js', size: 0 }]),
    /file limit/,
  );

  const exactEnvelope = {
    manifestBytes: RELEASE_LIMITS.maxManifestBytes,
    uncompressedArchiveBytes: RELEASE_LIMITS.maxUncompressedArchiveBytes,
    compressedArchiveBytes: RELEASE_LIMITS.maxCompressedArchiveBytes,
    archiveEntryCount: RELEASE_LIMITS.maxArchiveEntries,
  };
  assert.deepEqual(validateReleaseEnvelopeResourceSummary(exactEnvelope), exactEnvelope);
  for (const field of Object.keys(exactEnvelope)) {
    assert.throws(
      () => validateReleaseEnvelopeResourceSummary({ [field]: exactEnvelope[field] + 1 }),
      /exceeds/,
      `${field} accepted a value above its limit`,
    );
  }
});

test('preflight enforces the real per-file size ceiling before reading the file', () => {
  const fixture = makeFixture();
  try {
    truncateSync(
      path.join(fixture, 'be', 'dist', 'migrations', 'example.js'),
      RELEASE_LIMITS.maxPayloadFileBytes + 1,
    );
    assert.throws(
      () => preflightPayloadTree({ repoRoot: fixture, relativePath: 'be/dist' }),
      /payload file exceeds/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('verifier requires the release manifest to use exact canonical JSON serialization', () => {
  const fixture = makeFixture();
  try {
    const { payload, manifest } = buildFixtureRelease(fixture);
    const crafted = writeCraftedArchive({
      fixture,
      payload,
      manifest,
      manifestData: Buffer.from(JSON.stringify(manifest), 'utf8'),
      name: 'compact-manifest',
    });
    assert.throws(() => verifyReleaseArchive(crafted), /manifest is not in exact canonical JSON form/);
  } finally {
    cleanup(fixture);
  }
});

test('verifier rejects duplicate manifest keys even when JSON parsing yields the expected value', () => {
  const fixture = makeFixture();
  try {
    const { payload, manifest } = buildFixtureRelease(fixture);
    const canonical = serializeReleaseManifest(manifest).toString('utf8');
    const duplicateKey = Buffer.from(canonical.replace('{\n', '{\n  "schemaVersion": 1,\n'), 'utf8');
    const crafted = writeCraftedArchive({
      fixture,
      payload,
      manifest,
      manifestData: duplicateKey,
      name: 'duplicate-manifest-key',
    });
    assert.throws(() => verifyReleaseArchive(crafted), /manifest is not in exact canonical JSON form/);
  } finally {
    cleanup(fixture);
  }
});

test('an existing detached checksum cannot be replaced or cause a partial archive publication', () => {
  const fixture = makeFixture();
  try {
    const outputDir = path.join(fixture, 'output');
    mkdirSync(outputDir);
    const checksumPath = path.join(outputDir, `${RELEASE_ID}.tar.gz.sha256`);
    writeFileSync(checksumPath, 'sentinel checksum\n');
    assert.throws(
      () => packageRelease({ repoRoot: fixture, outputDir, metadata: metadata() }),
      /Refusing to overwrite immutable release output/,
    );
    assert.equal(readFileSync(checksumPath, 'utf8'), 'sentinel checksum\n');
    assert.equal(existsSync(path.join(outputDir, `${RELEASE_ID}.tar.gz`)), false);
  } finally {
    cleanup(fixture);
  }
});

test('an existing archive cannot be replaced and a newly staged checksum is rolled back', () => {
  const fixture = makeFixture();
  try {
    const outputDir = path.join(fixture, 'output');
    mkdirSync(outputDir);
    const archivePath = path.join(outputDir, `${RELEASE_ID}.tar.gz`);
    const checksumPath = `${archivePath}.sha256`;
    writeFileSync(archivePath, 'sentinel archive\n');
    assert.throws(
      () => packageRelease({ repoRoot: fixture, outputDir, metadata: metadata() }),
      /Refusing to overwrite immutable release output/,
    );
    assert.equal(readFileSync(archivePath, 'utf8'), 'sentinel archive\n');
    assert.equal(existsSync(checksumPath), false);
  } finally {
    cleanup(fixture);
  }
});

test('concurrent publishers cannot replace or corrupt the same immutable release', async () => {
  const fixture = makeFixture();
  try {
    const outputDir = path.join(fixture, 'output');
    const args = packageCliArguments(fixture, outputDir);
    const results = await Promise.all([spawnNode(args), spawnNode(args)]);
    const succeeded = results.filter((result) => result.status === 0);
    const rejected = results.filter((result) => result.status === 1);
    assert.equal(succeeded.length, 1, JSON.stringify(results));
    assert.equal(rejected.length, 1, JSON.stringify(results));
    assert.match(rejected[0].stderr, /Refusing to overwrite immutable release output/);
    const packaged = JSON.parse(succeeded[0].stdout);
    const verified = verifyReleaseArchive({ archivePath: packaged.archivePath, checksumPath: packaged.checksumPath });
    assert.equal(verified.manifest.releaseId, RELEASE_ID);
  } finally {
    cleanup(fixture);
  }
});

test('concurrent extractors cannot replace or corrupt the same immutable release', async () => {
  const fixture = makeFixture();
  try {
    const release = packageRelease({ repoRoot: fixture, outputDir: path.join(fixture, 'output'), metadata: metadata() });
    const releasesDirectory = path.join(fixture, 'releases');
    mkdirSync(releasesDirectory);
    const args = [
      path.join(SCRIPT_DIRECTORY, 'extract.mjs'),
      '--archive', release.archivePath,
      '--checksum', release.checksumPath,
      '--expected-archive-sha256', release.archiveSha256,
      '--releases-directory', releasesDirectory,
      ...productionEvidenceCliArguments(),
    ];
    const results = await Promise.all([spawnNode(args), spawnNode(args)]);
    const succeeded = results.filter((result) => result.status === 0);
    const rejected = results.filter((result) => result.status === 1);
    assert.equal(succeeded.length, 1, JSON.stringify(results));
    assert.equal(rejected.length, 1, JSON.stringify(results));
    assert.match(rejected[0].stderr, /Release directory already exists|extraction reservation failed/);
    assert.equal(
      readFileSync(path.join(releasesDirectory, RELEASE_ID, 'be', 'dist', 'app.js'), 'utf8'),
      readFileSync(path.join(fixture, 'be', 'dist', 'app.js'), 'utf8'),
    );
    assert.deepEqual(
      readdirSync(releasesDirectory).filter((entry) => entry.startsWith('.extract-') || entry.startsWith('.reserve-')),
      [],
    );
  } finally {
    cleanup(fixture);
  }
});
