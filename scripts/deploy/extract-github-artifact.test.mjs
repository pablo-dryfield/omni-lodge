import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

import {
  extractGitHubArtifact,
  serializeExtractionResult,
} from './extract-github-artifact.mjs';
import {
  createGitHubReleaseEvidence,
  serializeGitHubReleaseEvidence,
} from './github-release-evidence.mjs';

const sourceSha = '1234567890abcdef1234567890abcdef12345678';
const runId = '34902107741';
const runAttempt = '2';
const artifactId = '880044';
const releaseId = `omnilodge-r${runId}-a${runAttempt}-${sourceSha.slice(0, 12)}`;
const archiveName = `${releaseId}.tar.gz`;
const checksumName = `${archiveName}.sha256`;
const archiveData = Buffer.from('deterministic-inner-release-archive-for-artifact-binding');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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

const buildZip = (inputEntries, options = {}) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const input of inputEntries) {
    const nameBytes = Buffer.from(input.name, 'utf8');
    const data = Buffer.from(input.data);
    const method = input.method ?? 8;
    const compressedBase = method === 8 ? deflateRawSync(data) : Buffer.from(data);
    const compressed = input.compressedSuffix
      ? Buffer.concat([compressedBase, Buffer.from(input.compressedSuffix)])
      : compressedBase;
    const actualCrc = crc32(data);
    const centralCrc = input.centralCrc ?? actualCrc;
    const centralCompressedSize = input.centralCompressedSize ?? compressed.length;
    const centralUncompressedSize = input.centralUncompressedSize ?? data.length;
    const descriptor = input.descriptor ?? true;
    const flags = input.flags ?? (0x0800 | (descriptor ? 0x0008 : 0));
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(descriptor ? 0 : centralCrc, 14);
    localHeader.writeUInt32LE(descriptor ? 0 : centralCompressedSize, 18);
    localHeader.writeUInt32LE(descriptor ? 0 : centralUncompressedSize, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const descriptorBytes = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) {
      descriptorBytes.writeUInt32LE(0x08074b50, 0);
      descriptorBytes.writeUInt32LE(centralCrc, 4);
      descriptorBytes.writeUInt32LE(centralCompressedSize, 8);
      descriptorBytes.writeUInt32LE(centralUncompressedSize, 12);
    }
    localParts.push(localHeader, nameBytes, compressed, descriptorBytes);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(input.versionMadeBy ?? 0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(centralCrc, 16);
    centralHeader.writeUInt32LE(centralCompressedSize, 20);
    centralHeader.writeUInt32LE(centralUncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt32LE(input.externalAttributes ?? ((0o100644 << 16) >>> 0), 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + compressed.length + descriptorBytes.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const comment = Buffer.from(options.comment || '');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(inputEntries.length, 8);
  end.writeUInt16LE(inputEntries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([localData, centralData, end, comment, Buffer.from(options.trailing || '')]);
};

const standardEntries = (overrides = {}) => {
  const checksumData = Buffer.from(`${sha256(archiveData)}  ${archiveName}\n`);
  return [
    { name: archiveName, data: archiveData, ...overrides.archive },
    { name: checksumName, data: checksumData, ...overrides.checksum },
  ];
};

const buildEvidence = (zip, overrides = {}) => {
  const artifactDigest = `sha256:${sha256(zip)}`;
  const evidence = {
    schemaVersion: 2,
    operation: { name: 'deploy', trigger: 'manual' },
    activationAuthorization: { mode: 'manual', authorized: true, reason: 'authorized' },
    release: {
      releaseId,
      sourceSha,
      runId,
      runAttempt,
      artifactId,
      artifactName: releaseId,
      artifactDigest,
    },
    productionEvidence: {
      workflowConclusion: 'success',
      artifactId,
      artifactDigest,
      expectedReleaseId: releaseId,
      expectedSourceSha: sourceSha,
      expectedRepository: 'pablo-dryfield/omni-lodge',
      expectedWorkflowPath: '.github/workflows/release.yml',
      expectedEvent: 'push',
      expectedRef: 'refs/heads/master',
      expectedRunId: runId,
      expectedRunAttempt: runAttempt,
      expectedArtifactName: releaseId,
    },
  };
  return {
    ...evidence,
    ...overrides,
    operation: overrides.operation ?? evidence.operation,
    activationAuthorization:
      overrides.activationAuthorization ?? evidence.activationAuthorization,
    release: overrides.release ?? evidence.release,
    productionEvidence: overrides.productionEvidence ?? evidence.productionEvidence,
  };
};

const makeFixture = ({ zip = buildZip(standardEntries()), evidence, evidenceText } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-artifact-binding-'));
  const artifactZipPath = path.join(root, 'artifact.zip');
  const evidencePath = path.join(root, 'evidence.json');
  const stagingDirectory = path.join(root, 'staging');
  fs.writeFileSync(artifactZipPath, zip);
  const actualEvidence = evidence ?? buildEvidence(zip);
  fs.writeFileSync(
    evidencePath,
    evidenceText ?? `${JSON.stringify(actualEvidence, null, 2)}\n`,
  );
  return {
    root,
    artifactZipPath,
    evidencePath,
    stagingDirectory,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

const extractFixture = (fixture) => extractGitHubArtifact({
  artifactZipPath: fixture.artifactZipPath,
  evidencePath: fixture.evidencePath,
  stagingDirectory: fixture.stagingDirectory,
});

test('binds the raw artifact ZIP digest and extracts only the exact inner release files', async () => {
  const fixture = makeFixture();
  try {
    const result = await extractFixture(fixture);
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.releaseId, releaseId);
    assert.equal(result.artifactZipSha256, sha256(fs.readFileSync(fixture.artifactZipPath)));
    assert.equal(result.archiveSha256, sha256(archiveData));
    assert.equal(result.archivePath, path.join(fixture.stagingDirectory, archiveName));
    assert.equal(result.checksumPath, path.join(fixture.stagingDirectory, checksumName));
    assert.deepEqual(result.operation, { name: 'deploy', trigger: 'manual' });
    assert.deepEqual(
      result.activationAuthorization,
      { mode: 'manual', authorized: true, reason: 'authorized' },
    );
    assert.deepEqual(fs.readdirSync(fixture.stagingDirectory).sort(), [archiveName, checksumName].sort());
    assert.deepEqual(fs.readFileSync(result.archivePath), archiveData);
    assert.equal(
      fs.readFileSync(result.checksumPath, 'utf8'),
      `${sha256(archiveData)}  ${archiveName}\n`,
    );
    assert.deepEqual(result.productionEvidence, buildEvidence(fs.readFileSync(fixture.artifactZipPath)).productionEvidence);
    assert.equal(serializeExtractionResult(result), `${JSON.stringify(result, null, 2)}\n`);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(fixture.stagingDirectory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(result.archivePath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(result.checksumPath).mode & 0o777, 0o600);
    }
  } finally {
    fixture.cleanup();
  }
});

test('rejects a group- or world-writable staging parent', {
  skip: process.platform === 'win32' ? 'POSIX ownership and mode checks do not apply on Windows' : false,
}, async () => {
  const fixture = makeFixture();
  try {
    fs.chmodSync(fixture.root, 0o777);
    await assert.rejects(
      extractFixture(fixture),
      /Staging directory parent cannot be group- or world-writable/,
    );
    assert.equal(fs.existsSync(fixture.stagingDirectory), false);
  } finally {
    fs.chmodSync(fixture.root, 0o700);
    fixture.cleanup();
  }
});

test('extracts canonical disabled-mode dry-run evidence emitted by the GitHub evidence generator', async () => {
  const zip = buildZip(standardEntries());
  const digest = `sha256:${sha256(zip)}`;
  const workflowRun = {
    id: Number(runId),
    run_attempt: Number(runAttempt),
    path: '.github/workflows/release.yml',
    event: 'push',
    head_branch: 'master',
    head_sha: sourceSha,
    status: 'completed',
    conclusion: 'success',
    repository: {
      id: 9001,
      full_name: 'pablo-dryfield/omni-lodge',
    },
    head_repository: {
      id: 9001,
      full_name: 'pablo-dryfield/omni-lodge',
    },
  };
  const releaseArtifact = {
    id: Number(artifactId),
    name: releaseId,
    expired: false,
    digest,
    workflow_run: {
      id: Number(runId),
      repository_id: 9001,
      head_repository_id: 9001,
      head_branch: 'master',
      head_sha: sourceSha,
    },
  };
  const evidence = createGitHubReleaseEvidence({
    run: workflowRun,
    artifactsResponse: { total_count: 1, artifacts: [releaseArtifact] },
    expectedRunId: runId,
    expectedRunAttempt: runAttempt,
    expectedSourceSha: sourceSha,
    expectedArtifactId: artifactId,
    configuredMode: 'disabled',
    trigger: 'manual',
    operation: 'dry-run',
  });
  const fixture = makeFixture({
    zip,
    evidenceText: serializeGitHubReleaseEvidence(evidence),
  });
  try {
    const result = await extractFixture(fixture);
    assert.equal(evidence.schemaVersion, 2);
    assert.deepEqual(result.operation, evidence.operation);
    assert.deepEqual(result.activationAuthorization, evidence.activationAuthorization);
    assert.equal(result.artifactZipSha256, sha256(zip));
    assert.deepEqual(result.productionEvidence, evidence.productionEvidence);
  } finally {
    fixture.cleanup();
  }
});

test('verifies stage and dry-run artifacts while production activation is disabled', async (t) => {
  for (const operation of ['stage', 'dry-run']) {
    await t.test(operation, async () => {
      const zip = buildZip(standardEntries());
      const evidence = buildEvidence(zip, {
        operation: { name: operation, trigger: 'manual' },
        activationAuthorization: {
          mode: 'disabled',
          authorized: false,
          reason: 'activation_not_requested',
        },
      });
      const fixture = makeFixture({ zip, evidence });
      try {
        const result = await extractFixture(fixture);
        assert.deepEqual(result.operation, { name: operation, trigger: 'manual' });
        assert.deepEqual(result.activationAuthorization, {
          mode: 'disabled',
          authorized: false,
          reason: 'activation_not_requested',
        });
        assert.equal(result.artifactZipSha256, sha256(zip));
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('rejects forged or inconsistent operation and activation authorization evidence', async (t) => {
  const zip = buildZip(standardEntries());
  const cases = [
    ['automatic dry-run', {
      operation: { name: 'dry-run', trigger: 'automatic' },
      activationAuthorization: {
        mode: 'disabled',
        authorized: false,
        reason: 'activation_not_requested',
      },
    }, /Automatic dry-run operations are not allowed/],
    ['disabled deploy', {
      activationAuthorization: {
        mode: 'disabled',
        authorized: true,
        reason: 'authorized',
      },
    }, /mode does not authorize activation/],
    ['manual automatic deploy', {
      operation: { name: 'deploy', trigger: 'automatic' },
      activationAuthorization: {
        mode: 'manual',
        authorized: true,
        reason: 'authorized',
      },
    }, /Automatic deployment is not authorized/],
    ['non-activation marked authorized', {
      operation: { name: 'stage', trigger: 'manual' },
      activationAuthorization: {
        mode: 'automatic',
        authorized: true,
        reason: 'authorized',
      },
    }, /must not authorize production activation/],
    ['missing deployment mode', {
      operation: { name: 'stage', trigger: 'manual' },
      activationAuthorization: {
        authorized: false,
        reason: 'activation_not_requested',
      },
    }, /schema does not match/],
    ['unknown deployment mode', {
      operation: { name: 'stage', trigger: 'manual' },
      activationAuthorization: {
        mode: 'MANUAL',
        authorized: false,
        reason: 'activation_not_requested',
      },
    }, /deployment mode is invalid/],
  ];
  for (const [name, overrides, pattern] of cases) {
    await t.test(name, async () => {
      const fixture = makeFixture({ zip, evidence: buildEvidence(zip, overrides) });
      try {
        await assert.rejects(extractFixture(fixture), pattern);
        assert.equal(fs.existsSync(fixture.stagingDirectory), false);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('supports canonical stored entries without data descriptors', async () => {
  const zip = buildZip(standardEntries({
    archive: { method: 0, descriptor: false },
    checksum: { method: 0, descriptor: false },
  }));
  const fixture = makeFixture({ zip });
  try {
    const result = await extractFixture(fixture);
    assert.deepEqual(fs.readFileSync(result.archivePath), archiveData);
    assert.equal(result.archiveSha256, sha256(archiveData));
  } finally {
    fixture.cleanup();
  }
});

test('rejects an authenticated digest mismatch and removes no caller-owned path', async () => {
  const zip = buildZip(standardEntries());
  const evidence = buildEvidence(zip);
  evidence.release.artifactDigest = `sha256:${'00'.repeat(32)}`;
  evidence.productionEvidence.artifactDigest = evidence.release.artifactDigest;
  const fixture = makeFixture({ zip, evidence });
  try {
    await assert.rejects(extractFixture(fixture), /does not match the authenticated artifact digest/);
    assert.equal(fs.existsSync(fixture.stagingDirectory), false);
  } finally {
    fixture.cleanup();
  }
});

test('rejects raw ZIP tampering after evidence creation', async () => {
  const original = buildZip(standardEntries());
  const evidence = buildEvidence(original);
  const tampered = Buffer.from(original);
  tampered[50] ^= 1;
  const fixture = makeFixture({ zip: tampered, evidence });
  try {
    await assert.rejects(extractFixture(fixture), /does not match the authenticated artifact digest/);
    assert.equal(fs.existsSync(fixture.stagingDirectory), false);
  } finally {
    fixture.cleanup();
  }
});

test('requires productionEvidence to be the exact evidence derived from release identity', async () => {
  const zip = buildZip(standardEntries());
  const evidence = buildEvidence(zip);
  evidence.productionEvidence = {
    ...evidence.productionEvidence,
    expectedRepository: 'attacker/fork',
  };
  const fixture = makeFixture({ zip, evidence });
  try {
    await assert.rejects(extractFixture(fixture), /exact verifier-compatible evidence/);
    assert.equal(fs.existsSync(fixture.stagingDirectory), false);
  } finally {
    fixture.cleanup();
  }
});

test('rejects traversal, duplicate, and extra ZIP entries', async (t) => {
  const cases = [
    ['traversal', [
      { name: '../release.tar.gz', data: archiveData },
      standardEntries()[1],
    ], /do not exactly match/],
    ['duplicate', [
      standardEntries()[0],
      { ...standardEntries()[0] },
    ], /duplicate entry name/],
    ['extra', [
      ...standardEntries(),
      { name: 'extra.txt', data: Buffer.from('extra') },
    ], /exactly two entries/],
  ];
  for (const [name, entries, pattern] of cases) {
    await t.test(name, async () => {
      const zip = buildZip(entries);
      const fixture = makeFixture({ zip });
      try {
        await assert.rejects(extractFixture(fixture), pattern);
        assert.equal(fs.existsSync(fixture.stagingDirectory), false);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('rejects encrypted, unsupported-compression, and link entries', async (t) => {
  const cases = [
    ['encrypted', standardEntries({ archive: { flags: 0x0809 } }), /encrypted/],
    ['unsupported compression', standardEntries({ archive: { method: 99 } }), /unsupported compression/],
    ['symbolic link', standardEntries({
      archive: { externalAttributes: ((0o120777 << 16) >>> 0) },
    }), /link or special/],
  ];
  for (const [name, entries, pattern] of cases) {
    await t.test(name, async () => {
      const zip = buildZip(entries);
      const fixture = makeFixture({ zip });
      try {
        await assert.rejects(extractFixture(fixture), pattern);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('rejects malformed or ambiguous ZIP envelope metadata', async (t) => {
  const valid = buildZip(standardEntries());
  const malformedCentral = Buffer.from(valid);
  const endOffset = malformedCentral.length - 22;
  const centralOffset = malformedCentral.readUInt32LE(endOffset + 16);
  malformedCentral.writeUInt32LE(0x11111111, centralOffset);
  const oversizedCentral = Buffer.from(valid);
  oversizedCentral.writeUInt32LE((64 * 1024) + 1, oversizedCentral.length - 22 + 12);
  const cases = [
    ['trailing bytes', Buffer.concat([valid, Buffer.from('trailing')]), /trailing or missing end metadata/],
    ['archive comment', buildZip(standardEntries(), { comment: 'comment' }), /trailing or missing end metadata/],
    ['central signature', malformedCentral, /invalid signature/],
    ['oversized central directory', oversizedCentral, /central directory is oversized/],
  ];
  for (const [name, zip, pattern] of cases) {
    await t.test(name, async () => {
      const fixture = makeFixture({ zip });
      try {
        await assert.rejects(extractFixture(fixture), pattern);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('rejects oversized declared inner content before creating staging', async () => {
  const zip = buildZip(standardEntries({
    archive: { centralUncompressedSize: (512 * 1024 * 1024) + 1 },
  }));
  const fixture = makeFixture({ zip });
  try {
    await assert.rejects(extractFixture(fixture), /exceeds the release archive size limit/);
    assert.equal(fs.existsSync(fixture.stagingDirectory), false);
  } finally {
    fixture.cleanup();
  }
});

test('rejects compressed trailing data, corruption, and a wrong inner checksum', async (t) => {
  const corruptZip = buildZip(standardEntries({ archive: { compressedSuffix: Buffer.from('junk') } }));
  const damagedDeflateZip = buildZip(standardEntries());
  const firstNameLength = damagedDeflateZip.readUInt16LE(26);
  const firstExtraLength = damagedDeflateZip.readUInt16LE(28);
  const firstDataOffset = 30 + firstNameLength + firstExtraLength;
  damagedDeflateZip[firstDataOffset + 1] ^= 0x80;
  const wrongChecksumEntries = standardEntries();
  wrongChecksumEntries[1] = {
    name: checksumName,
    data: Buffer.from(`${'00'.repeat(32)}  ${archiveName}\n`),
  };
  const cases = [
    ['compressed trailing data', corruptZip, /trailing data/],
    ['damaged deflate content', damagedDeflateZip, /Unable to extract|CRC does not match|size does not match/],
    ['wrong inner checksum', buildZip(wrongChecksumEntries), /does not match the release archive/],
  ];
  for (const [name, zip, pattern] of cases) {
    await t.test(name, async () => {
      const fixture = makeFixture({ zip });
      try {
        await assert.rejects(extractFixture(fixture), (error) => {
          assert.match(error.message, pattern);
          assert.match(error.message, /Staging residue was preserved/);
          return true;
        });
        assert.equal(fs.existsSync(fixture.stagingDirectory), true);
        assert.equal(fs.lstatSync(fixture.stagingDirectory).isDirectory(), true);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('rejects schema drift and noncanonical evidence JSON', async (t) => {
  const zip = buildZip(standardEntries());
  const extraFieldEvidence = buildEvidence(zip);
  extraFieldEvidence.unexpected = true;
  const cases = [
    ['extra field', makeFixture({ zip, evidence: extraFieldEvidence }), /schema does not match/],
    ['noncanonical JSON', makeFixture({
      zip,
      evidenceText: JSON.stringify(buildEvidence(zip)),
    }), /not in canonical JSON form/],
    ['unsupported version', makeFixture({
      zip,
      evidence: { ...buildEvidence(zip), schemaVersion: 3 },
    }), /schema version is unsupported/],
  ];
  for (const [name, fixture, pattern] of cases) {
    await t.test(name, async () => {
      try {
        await assert.rejects(extractFixture(fixture), pattern);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('never writes into or removes an existing staging directory', async () => {
  const fixture = makeFixture();
  try {
    fs.mkdirSync(fixture.stagingDirectory);
    const sentinel = path.join(fixture.stagingDirectory, 'sentinel');
    fs.writeFileSync(sentinel, 'preserve');
    await assert.rejects(extractFixture(fixture), /Staging directory already exists/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
  } finally {
    fixture.cleanup();
  }
});

test('CLI extracts the artifact and emits canonical non-secret handoff JSON', () => {
  const fixture = makeFixture();
  const scriptPath = fileURLToPath(new URL('./extract-github-artifact.mjs', import.meta.url));
  try {
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--artifact-zip', fixture.artifactZipPath,
      '--evidence-json', fixture.evidencePath,
      '--staging-dir', fixture.stagingDirectory,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(output.releaseId, releaseId);
    assert.equal(output.archivePath, path.join(fixture.stagingDirectory, archiveName));
    assert.equal(result.stdout, `${JSON.stringify(output, null, 2)}\n`);
    assert.doesNotMatch(result.stdout, /token|password|privateKey|secret/i);
  } finally {
    fixture.cleanup();
  }
});

test('CLI fails closed without writing JSON on unknown or missing arguments', () => {
  const scriptPath = fileURLToPath(new URL('./extract-github-artifact.mjs', import.meta.url));
  const unknown = spawnSync(process.execPath, [scriptPath, '--unknown', 'value'], { encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown CLI option/);

  const missing = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /--artifact-zip is required/);
});
