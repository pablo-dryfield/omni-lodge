import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  CANONICAL_RELEASE_REF,
  CANONICAL_REPOSITORY,
  CANONICAL_WORKFLOW_PATH,
  RELEASE_LIMITS,
  REQUIRED_PAYLOAD_FILES,
  assertPayloadPathAllowed,
  assertSafeRelativePath,
  serializeReleaseManifest,
} from '../../../../scripts/release/lib.mjs';
import {
  parseCanonicalHostActivationSnapshotBytes,
} from '../../../../scripts/deploy/host/state.mjs';
import { HOST_DEPLOY_PATHS } from './constants.mjs';

const RELEASE_ID_PATTERN = /^omnilodge-r([1-9][0-9]*)-a([1-9][0-9]*)-([0-9a-f]{12})$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PARTIAL_DEPENDENCY_LAYER_PATTERN = /^\.[0-9a-f]{64}\.partial$/;
const COMPONENT_NAMES = Object.freeze(['backend', 'ui-server']);
const LOCKFILE_BY_COMPONENT = Object.freeze({
  backend: 'be/package-lock.json',
  'ui-server': 'ui-server/package-lock.json',
});
const PACKAGE_FILE_BY_COMPONENT = Object.freeze({
  backend: 'be/package.json',
  'ui-server': 'ui-server/package.json',
});
const TOP_LEVEL_MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'releaseId',
  'sourceSha',
  'builtAtUtc',
  'toolchain',
  'lockfiles',
  'mainUiAsset',
  'fileCount',
  'files',
  'workflow',
  'productionEligibility',
]);
const LOCKFILE_KEYS = Object.freeze([
  'be/package-lock.json',
  'ui/package-lock.json',
  'ui-server/package-lock.json',
]);
const WORKFLOW_KEYS = Object.freeze([
  'repository',
  'canonicalRepository',
  'workflowName',
  'workflowPath',
  'canonicalWorkflowPath',
  'event',
  'ref',
  'headSha',
  'runId',
  'runAttempt',
  'runNumber',
  'actor',
  'artifactName',
]);
const ELIGIBILITY_KEYS = Object.freeze([
  'canonicalRepository',
  'canonicalWorkflowPath',
  'requiredEvent',
  'requiredRef',
  'candidate',
  'reasons',
  'externalChecksRequired',
]);
const EXTERNAL_CHECKS = Object.freeze([
  'workflow_conclusion_success',
  'immutable_github_artifact_id',
  'authenticated_github_artifact_digest',
  'expected_release_identity',
  'protected_environment_authorization',
]);
const DEPENDENCY_MARKER_FILE = '.omnilodge-dependency.json';
const DEPENDENCY_PARTIAL_MARKER_FILE = '.omnilodge-partial.json';
// Bump this when the dependency layer publication/validation format changes in
// a way that should force production to build fresh immutable node_modules
// layers instead of reusing previously published layer directories.
const DEPENDENCY_LAYER_FORMAT_VERSION = 2;
const PINNED_NODE_VERSION = '22.23.2';
const PINNED_NPM_VERSION = '10.9.8';
const TARGET_PLATFORM = 'linux';
const TARGET_ARCH = 'x64';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTIVE_ACTIVATION_SNAPSHOT_FILE = 'active-activation-snapshot.json';
const DEPENDENCY_INSTALL_FLAGS = Object.freeze([
  'ci',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
  '--ignore-scripts',
]);
const DEPENDENCY_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const DEPENDENCY_EXECUTION_TERM_GRACE_MS = 10 * 1000;
const CAPACITY_PROOF_MAX_AGE_MS = 5 * 60 * 1000;
const PREPARATION_PLAN_SCHEMA_VERSION = 2;
const PREPARATION_STATE_SCHEMA_VERSION = 1;
const INSTALL_IDENTITY_NAME = 'omnilodge-install';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEPENDENCY_TREE_LIMITS = Object.freeze({
  maxEntries: 250_000,
  maxFileBytes: 1024 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxRelativePathBytes: 4096,
  maxDepth: 128,
});

const fail = (message) => {
  throw new Error(message);
};

const supportsPosixStableMetadata = () => process.platform !== 'win32';

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export const PRODUCTION_RELEASE_LAYOUT = deepFreeze({
  trustedRoot: '/',
  releasesRoot: '/opt/omnilodge/releases',
  dependenciesRoot: '/opt/omnilodge/dependencies',
  npmCacheRoot: '/var/cache/omnilodge/npm',
  puppeteerCacheRoot: '/var/cache/omnilodge/puppeteer',
  persistentRoot: '/var/lib/omnilodge',
  installerHomeRoot: '/var/lib/omnilodge/deploy/installer-home',
});

export const DEFAULT_RELEASE_GARBAGE_COLLECTION_POLICY = deepFreeze({
  minimumRetainedUnprotectedReleases: 0,
  unprotectedReleaseRetentionMs: 0,
  unreferencedDependencyLayerRetentionMs: 0,
  stalePartialDependencyRetentionMs: DAY_MS,
  minimumRetainedActivationSnapshots: 4,
  activationSnapshotRetentionMs: 0,
  minimumRetainedSourceMapReleases: 0,
  sourceMapRetentionMs: 0,
  stagingRetentionMs: 0,
});

export const PRODUCTION_CURRENT_RELEASE_LINKS = deepFreeze([
  '/opt/omnilodge/backend-current',
  '/opt/omnilodge/ui-current',
]);

const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const canonicalDigest = (value) => createHash('sha256').update(canonicalBytes(value)).digest('hex');

const sameKeys = (value, expected, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(expected)) {
    fail(`${label} has unexpected, missing, or non-canonical keys`);
  }
};

const normalizePath = (value) => {
  let normalized = path.normalize(path.resolve(value));
  const root = path.parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const pathsEqual = (left, right) => normalizePath(left) === normalizePath(right);

const isWithin = (parent, candidate) => {
  const normalizedParent = normalizePath(parent);
  const normalizedCandidate = normalizePath(candidate);
  if (normalizedCandidate === normalizedParent) return true;
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative !== ''
    && !relative.startsWith('..')
    && !path.isAbsolute(relative);
};

const validateTrustedLayout = (layout) => {
  sameKeys(layout, [
    'trustedRoot',
    'releasesRoot',
    'dependenciesRoot',
    'npmCacheRoot',
    'puppeteerCacheRoot',
    'persistentRoot',
    'installerHomeRoot',
  ], 'trusted release layout');
  const normalized = {};
  for (const [name, value] of Object.entries(layout)) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
      fail(`Trusted layout ${name} must be an absolute path`);
    }
    if (!pathsEqual(value, path.resolve(value))) fail(`Trusted layout ${name} must be normalized`);
    normalized[name] = path.resolve(value);
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (name !== 'trustedRoot' && !isWithin(normalized.trustedRoot, value)) {
      fail(`Trusted layout ${name} escapes its trusted ancestor root`);
    }
  }
  if (!isWithin(normalized.dependenciesRoot, path.join(normalized.dependenciesRoot, 'backend'))
      || !isWithin(normalized.dependenciesRoot, path.join(normalized.dependenciesRoot, 'ui-server'))) {
    fail('Trusted dependency roots are invalid');
  }
  return deepFreeze(normalized);
};

const ownerUid = () => (typeof process.getuid === 'function' ? process.getuid() : null);

const pathChain = (targetPath) => {
  const result = [];
  let current = path.resolve(targetPath);
  for (;;) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result.reverse();
};

const assertTrustedPathChain = (
  targetPath,
  label,
  {
    expectedLeafType = 'directory',
    owner = ownerUid(),
    trustedRoot = path.parse(path.resolve(targetPath)).root,
  } = {},
) => {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedTrustRoot = path.resolve(trustedRoot);
  if (!isWithin(resolvedTrustRoot, resolvedTarget)) fail(`${label} escapes its trusted ancestor root`);
  const fullChain = pathChain(resolvedTarget);
  const trustRootIndex = fullChain.findIndex((component) => pathsEqual(component, resolvedTrustRoot));
  if (trustRootIndex === -1) fail(`${label} trusted ancestor root is not in the path chain`);
  const chain = fullChain.slice(trustRootIndex);
  const first = [];
  const allowedOwners = new Set([0n]);
  if (owner !== null) allowedOwners.add(BigInt(owner));
  for (let index = 0; index < chain.length; index += 1) {
    const component = chain[index];
    const stat = lstatSync(component, { bigint: true });
    const isLeaf = index === chain.length - 1;
    const expectedType = isLeaf ? expectedLeafType : 'directory';
    if (stat.isSymbolicLink()
        || (expectedType === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
      fail(`${label} has an unsafe ${isLeaf ? 'leaf' : 'ancestor'}: ${component}`);
    }
    if (process.platform !== 'win32') {
      if (!allowedOwners.has(stat.uid)) fail(`${label} has an untrusted owner: ${component}`);
      if ((Number(stat.mode) & 0o022) !== 0) fail(`${label} has a group- or world-writable ancestor: ${component}`);
    }
    first.push(stat);
  }
  if (!pathsEqual(realpathSync.native(resolvedTarget), resolvedTarget)) {
    fail(`${label} or one of its ancestors resolves through a link`);
  }
  if (supportsPosixStableMetadata()) {
    for (let index = 0; index < chain.length; index += 1) {
      const component = chain[index];
      const after = lstatSync(component, { bigint: true });
      const before = first[index];
      if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeNs !== before.ctimeNs) {
        fail(`${label} ancestor changed during validation: ${component}`);
      }
    }
  }
  return first.at(-1);
};

const assertRealDirectory = (directoryPath, label, { ownerUid: owner = null, trustedRoot } = {}) => {
  if (!existsSync(directoryPath)) fail(`${label} is missing`);
  return assertTrustedPathChain(directoryPath, label, {
    expectedLeafType: 'directory',
    owner,
    trustedRoot,
  });
};

const assertTrustedParent = (targetPath, label, { owner = ownerUid(), trustedRoot } = {}) =>
  assertTrustedPathChain(path.dirname(path.resolve(targetPath)), `${label} parent`, {
    expectedLeafType: 'directory',
    owner,
    trustedRoot,
  });

const pathEntryExists = (entryPath) => {
  try {
    lstatSync(entryPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const hashDescriptor = (descriptor, size) => {
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let offset = 0;
  while (offset < size) {
    const amount = Math.min(chunk.length, size - offset);
    const bytesRead = readSync(descriptor, chunk, 0, amount, offset);
    if (bytesRead <= 0) fail('File changed or became truncated while hashing');
    hash.update(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest('hex');
};

const readStableRegularFile = (
  filePath,
  label,
  { maximumBytes = RELEASE_LIMITS.maxPayloadFileBytes, captureBytes = false } = {},
) => {
  if (!existsSync(filePath)) fail(`${label} is missing`);
  const before = lstatSync(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    fail(`${label} must be one non-linked regular file`);
  }
  const uid = ownerUid();
  if (uid !== null && process.platform !== 'win32' && before.uid !== BigInt(uid)) {
    fail(`${label} is not owned by the deployment process user`);
  }
  if (process.platform !== 'win32' && (Number(before.mode) & 0o022) !== 0) {
    fail(`${label} must not be group- or world-writable`);
  }
  if (before.size < 0n || before.size > BigInt(maximumBytes)) fail(`${label} has an invalid size`);
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const openedSameFile = supportsPosixStableMetadata()
      ? opened.dev === before.dev && opened.ino === before.ino
      : true;
    if (!opened.isFile()
        || !openedSameFile
        || opened.size !== before.size) {
      fail(`${label} changed while it was opened`);
    }
    const size = Number(opened.size);
    let data = null;
    let digest;
    if (captureBytes) {
      data = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const bytesRead = readSync(descriptor, data, offset, size - offset, offset);
        if (bytesRead <= 0) fail(`${label} changed or became truncated while being read`);
        offset += bytesRead;
      }
      digest = createHash('sha256').update(data).digest('hex');
    } else {
      digest = hashDescriptor(descriptor, size);
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(filePath, { bigint: true });
    const unchangedIdentity = supportsPosixStableMetadata()
      ? after.dev === opened.dev
        && after.ino === opened.ino
        && pathAfter.dev === opened.dev
        && pathAfter.ino === opened.ino
      : true;
    const unchangedTimes = supportsPosixStableMetadata()
      ? after.mtimeNs === opened.mtimeNs && after.ctimeNs === opened.ctimeNs
      : true;
    if (!unchangedIdentity
        || after.size !== opened.size
        || !unchangedTimes) {
      fail(`${label} changed while it was hashed`);
    }
    const snapshot = deepFreeze({
      size,
      sha256: digest,
      dev: opened.dev.toString(),
      ino: opened.ino.toString(),
      mtimeNs: opened.mtimeNs.toString(),
      ctimeNs: opened.ctimeNs.toString(),
    });
    return { snapshot, data };
  } finally {
    closeSync(descriptor);
  }
};

const snapshotRegularFile = (filePath, label, options) =>
  readStableRegularFile(filePath, label, options).snapshot;

const snapshotFingerprint = (snapshots) => {
  const hash = createHash('sha256');
  for (const item of snapshots) {
    hash.update(`${item.path}\0${item.size}\0${item.sha256}\0${item.dev}\0${item.ino}\0${item.mtimeNs}\0${item.ctimeNs}\n`);
  }
  return hash.digest('hex');
};

const expectedDirectorySet = (filePaths) => {
  const directories = new Set(['']);
  for (const relativePath of filePaths) {
    const segments = relativePath.split('/');
    segments.pop();
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      directories.add(current);
    }
  }
  return directories;
};

const walkReleaseTree = (releaseRoot) => {
  const files = new Set();
  const directories = new Set(['']);
  const links = new Set();
  let entries = 0;
  const visit = (absoluteDirectory, relativeDirectory, depth) => {
    if (depth > DEPENDENCY_TREE_LIMITS.maxDepth) fail('Extracted release exceeds the bounded depth limit');
    for (const name of readdirSync(absoluteDirectory).sort()) {
      entries += 1;
      if (entries > RELEASE_LIMITS.maxPayloadFileCount * 4) {
        fail('Extracted release exceeds the bounded entry limit');
      }
      const absolutePath = path.join(absoluteDirectory, name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      assertSafeRelativePath(relativePath, 'extracted release path');
      const stat = lstatSync(absolutePath, { bigint: true });
      if (stat.isSymbolicLink()) {
        links.add(relativePath);
      } else if (stat.isDirectory()) {
        const uid = ownerUid();
        if (uid !== null && process.platform !== 'win32' && stat.uid !== BigInt(uid)) {
          fail(`Extracted release directory is not owned by the deployment process user: ${relativePath}`);
        }
        if (process.platform !== 'win32' && (Number(stat.mode) & 0o022) !== 0) {
          fail(`Extracted release directory is group- or world-writable: ${relativePath}`);
        }
        directories.add(relativePath);
        visit(absolutePath, relativePath, depth + 1);
        const after = lstatSync(absolutePath, { bigint: true });
        if (!after.isDirectory() || after.dev !== stat.dev || after.ino !== stat.ino
            || after.ctimeNs !== stat.ctimeNs) {
          fail(`Extracted release directory changed during verification: ${relativePath}`);
        }
      } else if (stat.isFile()) {
        files.add(relativePath);
      } else {
        fail(`Extracted release contains a special file: ${relativePath}`);
      }
    }
  };
  visit(releaseRoot, '', 1);
  return { files, directories, links };
};

const assertSameSet = (actual, expected, label) => {
  if (actual.size !== expected.size) fail(`${label} has unexpected or missing entries`);
  for (const value of actual) if (!expected.has(value)) fail(`${label} contains an unexpected entry: ${value}`);
};

const validateManifestIdentity = ({ manifest, expectedReleaseId, expectedSourceSha }) => {
  sameKeys(manifest, TOP_LEVEL_MANIFEST_KEYS, 'release manifest');
  if (manifest.schemaVersion !== 1) fail('Release manifest schema is unsupported');
  const match = RELEASE_ID_PATTERN.exec(manifest.releaseId);
  if (!match || manifest.releaseId !== expectedReleaseId) fail('Release manifest ID does not match trusted evidence');
  if (!SOURCE_SHA_PATTERN.test(manifest.sourceSha) || manifest.sourceSha !== expectedSourceSha) {
    fail('Release manifest source SHA does not match trusted evidence');
  }
  if (match[3] !== manifest.sourceSha.slice(0, 12)) fail('Release ID is not bound to its source SHA');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.builtAtUtc)
      || Number.isNaN(Date.parse(manifest.builtAtUtc))
      || new Date(manifest.builtAtUtc).toISOString() !== manifest.builtAtUtc) {
    fail('Release build timestamp is invalid');
  }

  sameKeys(manifest.toolchain, ['node', 'npm'], 'manifest toolchain');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.toolchain.node)
      || !/^\d+\.\d+\.\d+$/.test(manifest.toolchain.npm)) fail('Manifest toolchain is invalid');
  if (manifest.toolchain.node !== PINNED_NODE_VERSION
      || manifest.toolchain.npm !== PINNED_NPM_VERSION) {
    fail('Manifest toolchain does not match the pinned production runtime');
  }
  sameKeys(manifest.lockfiles, LOCKFILE_KEYS, 'manifest lockfiles');
  for (const value of Object.values(manifest.lockfiles)) {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail('Manifest lockfile hash is invalid');
  }

  if (!Number.isSafeInteger(manifest.fileCount)
      || manifest.fileCount < 1
      || manifest.fileCount > RELEASE_LIMITS.maxPayloadFileCount
      || !Array.isArray(manifest.files)
      || manifest.files.length !== manifest.fileCount) fail('Manifest file inventory is invalid');
  const seen = new Set();
  let totalBytes = 0;
  let previous = null;
  for (const file of manifest.files) {
    sameKeys(file, ['path', 'size', 'sha256'], 'manifest file entry');
    assertPayloadPathAllowed(file.path);
    if (previous !== null && previous >= file.path) fail('Manifest files are not unique and canonically sorted');
    previous = file.path;
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > RELEASE_LIMITS.maxPayloadFileBytes) {
      fail(`Manifest payload size is invalid: ${file.path}`);
    }
    if (!SHA256_PATTERN.test(file.sha256)) fail(`Manifest payload hash is invalid: ${file.path}`);
    seen.add(file.path);
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > RELEASE_LIMITS.maxPayloadTotalBytes) {
      fail('Manifest payload exceeds the release size limit');
    }
  }
  for (const required of [
    ...REQUIRED_PAYLOAD_FILES,
    'ui-server/package-lock.json',
  ]) {
    if (!seen.has(required)) fail(`Manifest is missing a runtime dependency input: ${required}`);
  }
  assertSafeRelativePath(manifest.mainUiAsset, 'manifest main UI asset');
  if (!/^ui\/build\/static\/js\/main\.[A-Za-z0-9_-]+\.js$/.test(manifest.mainUiAsset)
      || !seen.has(manifest.mainUiAsset)) fail('Manifest main UI asset is invalid or missing');

  sameKeys(manifest.workflow, WORKFLOW_KEYS, 'manifest workflow');
  if (manifest.workflow.repository !== CANONICAL_REPOSITORY
      || manifest.workflow.canonicalRepository !== CANONICAL_REPOSITORY
      || manifest.workflow.workflowPath !== CANONICAL_WORKFLOW_PATH
      || manifest.workflow.canonicalWorkflowPath !== CANONICAL_WORKFLOW_PATH
      || manifest.workflow.event !== 'push'
      || manifest.workflow.ref !== CANONICAL_RELEASE_REF
      || manifest.workflow.headSha !== manifest.sourceSha
      || String(manifest.workflow.runId) !== match[1]
      || Number(manifest.workflow.runAttempt) !== Number(match[2])
      || manifest.workflow.artifactName !== manifest.releaseId) {
    fail('Release workflow provenance is not bound to the candidate identity');
  }
  if (!Number.isSafeInteger(manifest.workflow.runAttempt) || manifest.workflow.runAttempt < 1
      || typeof manifest.workflow.runId !== 'string' || !/^[1-9][0-9]*$/.test(manifest.workflow.runId)
      || typeof manifest.workflow.workflowName !== 'string' || manifest.workflow.workflowName.trim() === ''
      || !(manifest.workflow.runNumber === null
        || (typeof manifest.workflow.runNumber === 'string' && /^[1-9][0-9]*$/.test(manifest.workflow.runNumber)))
      || !(manifest.workflow.actor === null
        || (typeof manifest.workflow.actor === 'string' && manifest.workflow.actor.trim() !== ''))) {
    fail('Release workflow run identity is invalid');
  }

  sameKeys(manifest.productionEligibility, ELIGIBILITY_KEYS, 'manifest production eligibility');
  if (manifest.productionEligibility.canonicalRepository !== CANONICAL_REPOSITORY
      || manifest.productionEligibility.canonicalWorkflowPath !== CANONICAL_WORKFLOW_PATH
      || manifest.productionEligibility.requiredEvent !== 'push'
      || manifest.productionEligibility.requiredRef !== CANONICAL_RELEASE_REF
      || manifest.productionEligibility.candidate !== true
      || !Array.isArray(manifest.productionEligibility.reasons)
      || manifest.productionEligibility.reasons.length !== 0
      || JSON.stringify(manifest.productionEligibility.externalChecksRequired) !== JSON.stringify(EXTERNAL_CHECKS)) {
    fail('Release manifest is not a canonical production candidate');
  }
  return { totalBytes };
};

const buildManagedLinks = ({ releaseRoot, dependencies, layout }) => deepFreeze([
  {
    relativePath: 'be/node_modules',
    targetPath: dependencies.backend.nodeModulesPath,
    targetType: 'directory',
  },
  {
    relativePath: 'be/error.log',
    targetPath: path.join(layout.persistentRoot, 'logs/backend/error.log'),
    targetType: 'file',
  },
  {
    relativePath: 'be/combined.log',
    targetPath: path.join(layout.persistentRoot, 'logs/backend/combined.log'),
    targetType: 'file',
  },
  {
    relativePath: 'be/runtime',
    targetPath: path.join(layout.persistentRoot, 'runtime/backend'),
    targetType: 'directory',
  },
  {
    relativePath: 'ui-server/node_modules',
    targetPath: dependencies['ui-server'].nodeModulesPath,
    targetType: 'directory',
  },
  {
    relativePath: 'ui-server/error.log',
    targetPath: path.join(layout.persistentRoot, 'logs/ui-server/error.log'),
    targetType: 'file',
  },
  {
    relativePath: 'ui-server/combined.log',
    targetPath: path.join(layout.persistentRoot, 'logs/ui-server/combined.log'),
    targetType: 'file',
  },
].map((item) => ({ ...item, linkPath: path.join(releaseRoot, ...item.relativePath.split('/')) })));

export const dependencyLayerMaterial = ({
  lockSha256,
  packageSha256,
  node = PINNED_NODE_VERSION,
  npm = PINNED_NPM_VERSION,
  platform = TARGET_PLATFORM,
  arch = TARGET_ARCH,
  installFlags = DEPENDENCY_INSTALL_FLAGS,
}) => deepFreeze({
  layerFormatVersion: DEPENDENCY_LAYER_FORMAT_VERSION,
  lockSha256,
  packageSha256,
  node,
  npm,
  platform,
  arch,
  installFlags: deepFreeze([...installFlags]),
});

export const dependencyLayerKey = (material) => canonicalDigest(material);

const dependencyPlan = ({ component, releaseRoot, lockHash, packageHash, toolchain, layout }) => {
  const componentRoot = path.join(layout.dependenciesRoot, component);
  const material = dependencyLayerMaterial({
    lockSha256: lockHash,
    packageSha256: packageHash,
    node: toolchain.node,
    npm: toolchain.npm,
  });
  const layerKey = dependencyLayerKey(material);
  const finalPath = path.join(componentRoot, layerKey);
  const partialPath = path.join(componentRoot, `.${layerKey}.partial`);
  const packageRelativePath = PACKAGE_FILE_BY_COMPONENT[component];
  const lockRelativePath = LOCKFILE_BY_COMPONENT[component];
  return deepFreeze({
    component,
    layerKey,
    material,
    lockHash,
    packageHash,
    toolchain: deepFreeze({ ...toolchain }),
    componentRoot,
    finalPath,
    partialPath,
    nodeModulesPath: path.join(finalPath, 'node_modules'),
    sourcePackagePath: path.join(releaseRoot, ...packageRelativePath.split('/')),
    sourceLockPath: path.join(releaseRoot, ...lockRelativePath.split('/')),
    packageFileName: 'package.json',
    lockFileName: 'package-lock.json',
    npmCacheRoot: layout.npmCacheRoot,
    puppeteerCacheRoot: layout.puppeteerCacheRoot,
    installerHomeRoot: layout.installerHomeRoot,
    trustedRoot: layout.trustedRoot,
  });
};

const normalizeGarbageCollectionPolicy = (policy) => {
  sameKeys(policy, [
    'minimumRetainedUnprotectedReleases',
    'unprotectedReleaseRetentionMs',
    'unreferencedDependencyLayerRetentionMs',
    'stalePartialDependencyRetentionMs',
    'minimumRetainedActivationSnapshots',
    'activationSnapshotRetentionMs',
    'minimumRetainedSourceMapReleases',
    'sourceMapRetentionMs',
    'stagingRetentionMs',
  ], 'release garbage collection policy');
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(`Release garbage collection policy ${key} must be a non-negative safe integer`);
    }
  }
  return deepFreeze({ ...policy });
};

const addProtectionReason = (protectedReleaseReasons, releaseId, reason) => {
  if (!RELEASE_ID_PATTERN.test(releaseId)) return;
  if (!protectedReleaseReasons.has(releaseId)) protectedReleaseReasons.set(releaseId, new Set());
  protectedReleaseReasons.get(releaseId).add(reason);
};

const releaseIdFromPathWithinReleaseRoot = ({ targetPath, releasesRoot }) => {
  const releaseRoot = path.resolve(releasesRoot);
  const resolvedTarget = path.resolve(targetPath);
  if (!isWithin(releaseRoot, resolvedTarget)) return null;
  const relative = path.relative(releaseRoot, resolvedTarget);
  const [candidate, ...rest] = relative.split(path.sep);
  if (!RELEASE_ID_PATTERN.test(candidate)) return null;
  if (rest.length === 0 || (rest.length === 1 && rest[0] === 'be')) return candidate;
  return null;
};

const readCurrentReleaseLinkProtections = ({ layout, currentLinkPaths }) => {
  const warnings = [];
  const releaseIds = new Map();
  for (const linkPath of currentLinkPaths) {
    try {
      const target = readlinkSync(linkPath);
      const absoluteTarget = path.resolve(path.dirname(linkPath), target);
      const releaseId = releaseIdFromPathWithinReleaseRoot({
        targetPath: absoluteTarget,
        releasesRoot: layout.releasesRoot,
      });
      if (releaseId !== null) {
        addProtectionReason(releaseIds, releaseId, `current_link:${path.basename(linkPath)}`);
      } else {
        warnings.push(`Current release link does not target a managed release: ${linkPath}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        warnings.push(`Unable to inspect current release link ${linkPath}: ${error.message}`);
      }
    }
  }
  return { releaseIds, warnings };
};

const activationSnapshotTimestampMs = ({ snapshot, stat }) => {
  const activatedAt = Date.parse(snapshot.activatedAtUtc);
  if (!Number.isNaN(activatedAt)) return activatedAt;
  return Number(stat.mtimeMs);
};

const activationSnapshotRecord = ({
  name,
  snapshotPath,
  snapshot,
  stat,
  nowMs,
  reason,
}) => deepFreeze({
  name,
  path: snapshotPath,
  activationId: snapshot.activationId,
  releaseId: snapshot.releaseId,
  activatedAtUtc: snapshot.activatedAtUtc,
  ageMs: Math.max(0, nowMs - activationSnapshotTimestampMs({ snapshot, stat })),
  active: name === ACTIVE_ACTIVATION_SNAPSHOT_FILE,
  reason,
});

const readActivationSnapshotProtections = ({
  layout,
  paths,
  policy,
  nowMs,
}) => {
  const warnings = [];
  const releaseIds = new Map();
  let reliable = true;
  let entries = [];
  const validSnapshots = [];
  const invalid = [];
  try {
    entries = readdirSync(paths.stateRoot).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      warnings.push(`Activation state root is missing: ${paths.stateRoot}`);
      return {
        releaseIds,
        warnings,
        reliable: false,
        activationSnapshots: deepFreeze({
          kept: [],
          removable: [],
          invalid: [],
        }),
      };
    }
    throw error;
  }
  for (const name of entries) {
    if (name !== ACTIVE_ACTIVATION_SNAPSHOT_FILE && !name.endsWith('.activation-snapshot.json')) continue;
    const snapshotPath = path.join(paths.stateRoot, name);
    try {
      const stat = lstatSync(snapshotPath, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) {
        reliable = false;
        invalid.push(deepFreeze({ name, path: snapshotPath, reason: 'not_a_real_file' }));
        warnings.push(`Activation snapshot is not a real file: ${snapshotPath}`);
        continue;
      }
      const snapshot = parseCanonicalHostActivationSnapshotBytes(readFileSync(snapshotPath));
      if (snapshot.snapshotKind !== 'artifact_release') continue;
      if (!isWithin(layout.releasesRoot, snapshot.uiRestoreTarget)
          || !pathsEqual(snapshot.uiRestoreTarget, path.join(layout.releasesRoot, snapshot.releaseId))
          || !pathsEqual(snapshot.backendRestoreTarget, path.join(layout.releasesRoot, snapshot.releaseId, 'be'))) {
        reliable = false;
        warnings.push(`Activation snapshot does not point at the configured release root: ${snapshotPath}`);
        invalid.push(deepFreeze({ name, path: snapshotPath, reason: 'restore_target_outside_release_root' }));
        continue;
      }
      validSnapshots.push(deepFreeze({
        name,
        path: snapshotPath,
        snapshot,
        timestampMs: activationSnapshotTimestampMs({ snapshot, stat }),
        stat,
      }));
    } catch (error) {
      reliable = false;
      invalid.push(deepFreeze({
        name,
        path: snapshotPath,
        reason: error instanceof Error ? error.message : String(error),
      }));
      warnings.push(`Unable to inspect activation snapshot ${snapshotPath}: ${error.message}`);
    }
  }

  if (!reliable) {
    for (const snapshot of validSnapshots) {
      addProtectionReason(releaseIds, snapshot.snapshot.releaseId, `activation_snapshot_unreliable:${snapshot.snapshot.activationId}`);
    }
    return {
      releaseIds,
      warnings,
      reliable,
      activationSnapshots: deepFreeze({
        kept: deepFreeze(validSnapshots.map((snapshot) => activationSnapshotRecord({
          name: snapshot.name,
          snapshotPath: snapshot.path,
          snapshot: snapshot.snapshot,
          stat: snapshot.stat,
          nowMs,
          reason: 'activation_state_unreliable',
        }))),
        removable: [],
        invalid: deepFreeze(invalid),
      }),
    };
  }

  const retainedNamedSnapshots = new Set();
  const namedSnapshots = validSnapshots
    .filter((snapshot) => snapshot.name !== ACTIVE_ACTIVATION_SNAPSHOT_FILE)
    .sort((left, right) => right.timestampMs - left.timestampMs || right.name.localeCompare(left.name));
  namedSnapshots.forEach((snapshot, index) => {
    const ageMs = Math.max(0, nowMs - snapshot.timestampMs);
    if (index < policy.minimumRetainedActivationSnapshots) {
      retainedNamedSnapshots.add(snapshot.name);
    } else if (ageMs < policy.activationSnapshotRetentionMs) {
      retainedNamedSnapshots.add(snapshot.name);
    }
  });

  const kept = [];
  const removable = [];
  for (const snapshot of validSnapshots) {
    if (snapshot.name === ACTIVE_ACTIVATION_SNAPSHOT_FILE) {
      addProtectionReason(releaseIds, snapshot.snapshot.releaseId, `active_activation_snapshot:${snapshot.snapshot.activationId}`);
      kept.push(activationSnapshotRecord({
        name: snapshot.name,
        snapshotPath: snapshot.path,
        snapshot: snapshot.snapshot,
        stat: snapshot.stat,
        nowMs,
        reason: 'active_activation_snapshot',
      }));
      continue;
    }
    if (retainedNamedSnapshots.has(snapshot.name)) {
      addProtectionReason(releaseIds, snapshot.snapshot.releaseId, `retained_activation_snapshot:${snapshot.snapshot.activationId}`);
      kept.push(activationSnapshotRecord({
        name: snapshot.name,
        snapshotPath: snapshot.path,
        snapshot: snapshot.snapshot,
        stat: snapshot.stat,
        nowMs,
        reason: 'retained_activation_snapshot',
      }));
    } else {
      removable.push(activationSnapshotRecord({
        name: snapshot.name,
        snapshotPath: snapshot.path,
        snapshot: snapshot.snapshot,
        stat: snapshot.stat,
        nowMs,
        reason: 'old_activation_snapshot',
      }));
    }
  }

  return {
    releaseIds,
    warnings,
    reliable,
    activationSnapshots: deepFreeze({
      kept: deepFreeze(kept),
      removable: deepFreeze(removable),
      invalid: deepFreeze(invalid),
    }),
  };
};

const readCanonicalReleaseManifest = (releaseRoot, expectedReleaseId) => {
  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const manifestBytes = readStableRegularFile(manifestPath, 'Release garbage collection manifest', {
    maximumBytes: RELEASE_LIMITS.maxManifestBytes,
    captureBytes: true,
  }).data;
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Release manifest is invalid JSON: ${error.message}`, { cause: error });
  }
  if (!manifestBytes.equals(serializeReleaseManifest(manifest))) {
    fail('Release manifest is not canonical JSON');
  }
  validateManifestIdentity({
    manifest,
    expectedReleaseId,
    expectedSourceSha: manifest.sourceSha,
  });
  return manifest;
};

const releaseTimestampMs = ({ manifest, stat }) => {
  const builtAt = Date.parse(manifest.builtAtUtc);
  if (!Number.isNaN(builtAt)) return builtAt;
  return Number(stat.mtimeMs);
};

const inspectReleaseDirectories = ({ layout }) => {
  assertRealDirectory(layout.releasesRoot, 'Release root', {
    ownerUid: ownerUid(),
    trustedRoot: layout.trustedRoot,
  });
  const releases = [];
  const invalid = [];
  for (const name of readdirSync(layout.releasesRoot).sort()) {
    if (!RELEASE_ID_PATTERN.test(name)) continue;
    const releaseRoot = path.join(layout.releasesRoot, name);
    if (!isWithin(layout.releasesRoot, releaseRoot)) fail('Release garbage collection candidate escapes release root');
    try {
      const stat = lstatSync(releaseRoot, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        invalid.push(deepFreeze({ releaseId: name, path: releaseRoot, reason: 'not_a_real_directory' }));
        continue;
      }
      if (!pathsEqual(realpathSync.native(releaseRoot), releaseRoot)) {
        invalid.push(deepFreeze({ releaseId: name, path: releaseRoot, reason: 'resolves_through_link' }));
        continue;
      }
      const manifest = readCanonicalReleaseManifest(releaseRoot, name);
      releases.push(deepFreeze({
        releaseId: name,
        sourceSha: manifest.sourceSha,
        path: releaseRoot,
        builtAtUtc: manifest.builtAtUtc,
        timestampMs: releaseTimestampMs({ manifest, stat }),
        manifest,
      }));
    } catch (error) {
      invalid.push(deepFreeze({
        releaseId: name,
        path: releaseRoot,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return { releases, invalid };
};

const dependencyLayerKeysForRelease = ({ release, layout }) => {
  const result = {};
  for (const component of COMPONENT_NAMES) {
    const packageEntry = release.manifest.files.find((file) => file.path === PACKAGE_FILE_BY_COMPONENT[component]);
    const dependency = dependencyPlan({
      component,
      releaseRoot: release.path,
      lockHash: release.manifest.lockfiles[LOCKFILE_BY_COMPONENT[component]],
      packageHash: packageEntry.sha256,
      toolchain: release.manifest.toolchain,
      layout,
    });
    result[component] = dependency.layerKey;
  }
  return deepFreeze(result);
};

const entryAgeMs = ({ stat, nowMs }) => Math.max(0, nowMs - Number(stat.mtimeMs));

const inspectDependencyGarbage = ({
  layout,
  keptReleases,
  policy,
  nowMs,
  dependencyProtectionComplete,
}) => {
  const protectedLayers = Object.fromEntries(COMPONENT_NAMES.map((component) => [component, new Set()]));
  if (dependencyProtectionComplete) {
    for (const release of keptReleases) {
      const keys = dependencyLayerKeysForRelease({ release, layout });
      for (const component of COMPONENT_NAMES) protectedLayers[component].add(keys[component]);
    }
  }

  const byComponent = {};
  for (const component of COMPONENT_NAMES) {
    const componentRoot = path.join(layout.dependenciesRoot, component);
    assertRealDirectory(componentRoot, `${component} dependency root`, {
      ownerUid: ownerUid(),
      trustedRoot: layout.trustedRoot,
    });
    const kept = [];
    const removable = [];
    const invalid = [];
    const stalePartials = [];
    for (const name of readdirSync(componentRoot).sort()) {
      const layerPath = path.join(componentRoot, name);
      let stat;
      try {
        stat = lstatSync(layerPath, { bigint: true });
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        invalid.push(deepFreeze({ name, path: layerPath, reason: 'not_a_real_directory' }));
        continue;
      }
      if (PARTIAL_DEPENDENCY_LAYER_PATTERN.test(name)) {
        const ageMs = entryAgeMs({ stat, nowMs });
        const record = deepFreeze({
          name,
          path: layerPath,
          ageMs,
          reason: ageMs >= policy.stalePartialDependencyRetentionMs ? 'stale_partial_dependency' : 'recent_partial_dependency',
        });
        if (ageMs >= policy.stalePartialDependencyRetentionMs) stalePartials.push(record);
        else kept.push(record);
        continue;
      }
      if (!SHA256_PATTERN.test(name)) {
        invalid.push(deepFreeze({ name, path: layerPath, reason: 'unrecognized_dependency_layer_name' }));
        continue;
      }
      const ageMs = entryAgeMs({ stat, nowMs });
      const protectedByRelease = protectedLayers[component].has(name);
      const canRemove = dependencyProtectionComplete
        && !protectedByRelease
        && ageMs >= policy.unreferencedDependencyLayerRetentionMs;
      const record = deepFreeze({
        name,
        path: layerPath,
        ageMs,
        protected: protectedByRelease,
        reason: protectedByRelease
          ? 'referenced_by_retained_release'
          : (dependencyProtectionComplete ? 'unreferenced_dependency_layer' : 'dependency_protection_incomplete'),
      });
      if (canRemove) removable.push(record);
      else kept.push(record);
    }
    byComponent[component] = deepFreeze({
      protectedLayerKeys: deepFreeze([...protectedLayers[component]].sort()),
      kept: deepFreeze(kept),
      removable: deepFreeze(removable),
      stalePartials: deepFreeze(stalePartials),
      invalid: deepFreeze(invalid),
    });
  }
  return deepFreeze(byComponent);
};

const optionalRealDirectoryState = ({ directoryPath }) => {
  try {
    const stat = lstatSync(directoryPath, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { ok: false, missing: false, stat, reason: 'not_a_real_directory' };
    }
    if (!pathsEqual(realpathSync.native(directoryPath), directoryPath)) {
      return { ok: false, missing: false, stat, reason: 'resolves_through_link' };
    }
    return { ok: true, missing: false, stat, reason: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, missing: true, stat: null, reason: 'missing' };
    throw error;
  }
};

const inspectRunningRequestIds = ({ paths, warnings }) => {
  if (typeof paths.runningRequests !== 'string' || !path.isAbsolute(paths.runningRequests)) {
    warnings.push('Running request root is unavailable; staging cleanup was skipped');
    return null;
  }
  const runningState = optionalRealDirectoryState({ directoryPath: paths.runningRequests });
  if (!runningState.ok) {
    warnings.push(`Running request root is ${runningState.reason}; staging cleanup was skipped: ${paths.runningRequests}`);
    return null;
  }
  const runningRequestIds = new Set();
  for (const name of readdirSync(paths.runningRequests).sort()) {
    if (!name.endsWith('.json')) continue;
    const requestId = name.slice(0, -'.json'.length);
    if (REQUEST_ID_PATTERN.test(requestId)) runningRequestIds.add(requestId);
  }
  return runningRequestIds;
};

const inspectStagingGarbage = ({
  paths,
  policy,
  nowMs,
  warnings,
}) => {
  if (typeof paths.stagingRoot !== 'string' || !path.isAbsolute(paths.stagingRoot)) {
    return deepFreeze({
      root: paths.stagingRoot ?? null,
      kept: [],
      removable: [],
      invalid: [],
      skipped: true,
      reason: 'staging_root_unavailable',
    });
  }
  const stagingState = optionalRealDirectoryState({ directoryPath: paths.stagingRoot });
  if (stagingState.missing) {
    return deepFreeze({
      root: paths.stagingRoot,
      kept: [],
      removable: [],
      invalid: [],
      skipped: true,
      reason: 'staging_root_missing',
    });
  }
  if (!stagingState.ok) {
    warnings.push(`Staging root is unsafe; staging cleanup was skipped: ${paths.stagingRoot}`);
    return deepFreeze({
      root: paths.stagingRoot,
      kept: [],
      removable: [],
      invalid: [],
      skipped: true,
      reason: stagingState.reason,
    });
  }

  const runningRequestIds = inspectRunningRequestIds({ paths, warnings });
  const kept = [];
  const removable = [];
  const invalid = [];
  for (const name of readdirSync(paths.stagingRoot).sort()) {
    const stagingPath = path.join(paths.stagingRoot, name);
    let stat;
    try {
      stat = lstatSync(stagingPath, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!REQUEST_ID_PATTERN.test(name)) {
      invalid.push(deepFreeze({ name, path: stagingPath, reason: 'unrecognized_staging_directory_name' }));
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      invalid.push(deepFreeze({ name, path: stagingPath, reason: 'not_a_real_directory' }));
      continue;
    }
    const ageMs = entryAgeMs({ stat, nowMs });
    const running = runningRequestIds?.has(name) ?? false;
    const record = deepFreeze({
      name,
      path: stagingPath,
      ageMs,
      running,
      reason: running
        ? 'running_request_staging'
        : (runningRequestIds === null ? 'running_state_unavailable' : 'finished_or_abandoned_staging'),
    });
    if (runningRequestIds !== null && !running && ageMs >= policy.stagingRetentionMs) {
      removable.push(record);
    } else {
      kept.push(record);
    }
  }
  return deepFreeze({
    root: paths.stagingRoot,
    kept: deepFreeze(kept),
    removable: deepFreeze(removable),
    invalid: deepFreeze(invalid),
    skipped: false,
    reason: null,
  });
};

const inspectSourceMapGarbage = ({
  layout,
  keptReleaseIds,
  policy,
  nowMs,
  warnings,
}) => {
  const sourceMapsRoot = path.join(layout.persistentRoot, 'source-maps');
  const sourceMapState = optionalRealDirectoryState({ directoryPath: sourceMapsRoot });
  if (sourceMapState.missing) {
    return deepFreeze({
      root: sourceMapsRoot,
      kept: [],
      removable: [],
      invalid: [],
      skipped: true,
      reason: 'source_maps_root_missing',
    });
  }
  if (!sourceMapState.ok) {
    warnings.push(`Source-map root is unsafe; source-map cleanup was skipped: ${sourceMapsRoot}`);
    return deepFreeze({
      root: sourceMapsRoot,
      kept: [],
      removable: [],
      invalid: [],
      skipped: true,
      reason: sourceMapState.reason,
    });
  }

  const candidates = [];
  const invalid = [];
  for (const name of readdirSync(sourceMapsRoot).sort()) {
    const sourceMapPath = path.join(sourceMapsRoot, name);
    let stat;
    try {
      stat = lstatSync(sourceMapPath, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!RELEASE_ID_PATTERN.test(name)) {
      invalid.push(deepFreeze({ releaseId: name, path: sourceMapPath, reason: 'unrecognized_source_map_directory_name' }));
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      invalid.push(deepFreeze({ releaseId: name, path: sourceMapPath, reason: 'not_a_real_directory' }));
      continue;
    }
    candidates.push(deepFreeze({
      releaseId: name,
      path: sourceMapPath,
      timestampMs: Number(stat.mtimeMs),
      ageMs: entryAgeMs({ stat, nowMs }),
    }));
  }

  const newestUnprotected = new Set();
  candidates
    .filter((candidate) => !keptReleaseIds.has(candidate.releaseId))
    .sort((left, right) => right.timestampMs - left.timestampMs || right.releaseId.localeCompare(left.releaseId))
    .slice(0, policy.minimumRetainedSourceMapReleases)
    .forEach((candidate) => newestUnprotected.add(candidate.releaseId));

  const kept = [];
  const removable = [];
  for (const candidate of candidates) {
    const protectedByRelease = keptReleaseIds.has(candidate.releaseId);
    const retainedAsRecent = candidate.ageMs < policy.sourceMapRetentionMs;
    const retainedAsMinimum = newestUnprotected.has(candidate.releaseId);
    const record = deepFreeze({
      releaseId: candidate.releaseId,
      path: candidate.path,
      ageMs: candidate.ageMs,
      protected: protectedByRelease,
      reason: protectedByRelease
        ? 'retained_release_source_maps'
        : (retainedAsMinimum
          ? 'minimum_retained_source_map_release'
          : (retainedAsRecent ? 'recent_source_map_release' : 'old_source_map_release')),
    });
    if (protectedByRelease || retainedAsMinimum || retainedAsRecent) kept.push(record);
    else removable.push(record);
  }

  return deepFreeze({
    root: sourceMapsRoot,
    kept: deepFreeze(kept),
    removable: deepFreeze(removable),
    invalid: deepFreeze(invalid),
    skipped: false,
    reason: null,
  });
};

export const planManagedReleaseGarbageCollection = ({
  trustedLayout = PRODUCTION_RELEASE_LAYOUT,
  paths = HOST_DEPLOY_PATHS,
  policy: rawPolicy = DEFAULT_RELEASE_GARBAGE_COLLECTION_POLICY,
  currentLinkPaths = PRODUCTION_CURRENT_RELEASE_LINKS,
  protectedReleaseIds = [],
  now = () => new Date(),
} = {}) => {
  const layout = validateTrustedLayout(trustedLayout);
  const policy = normalizeGarbageCollectionPolicy(rawPolicy);
  const capturedAt = now();
  const capturedAtUtc = capturedAt.toISOString();
  const nowMs = capturedAt.getTime();
  const warnings = [];
  const protectedReleaseReasons = new Map();

  if (!Array.isArray(protectedReleaseIds)) fail('Protected release IDs must be an array');
  for (const releaseId of protectedReleaseIds) {
    if (!RELEASE_ID_PATTERN.test(releaseId)) fail(`Protected release ID is invalid: ${releaseId}`);
    addProtectionReason(protectedReleaseReasons, releaseId, 'explicit_protected_release');
  }

  const linkProtections = readCurrentReleaseLinkProtections({ layout, currentLinkPaths });
  warnings.push(...linkProtections.warnings);
  for (const [releaseId, reasons] of linkProtections.releaseIds) {
    for (const reason of reasons) addProtectionReason(protectedReleaseReasons, releaseId, reason);
  }

  const snapshotProtections = readActivationSnapshotProtections({
    layout,
    paths,
    policy,
    nowMs,
  });
  warnings.push(...snapshotProtections.warnings);
  for (const [releaseId, reasons] of snapshotProtections.releaseIds) {
    for (const reason of reasons) addProtectionReason(protectedReleaseReasons, releaseId, reason);
  }

  const inventory = inspectReleaseDirectories({ layout });
  if (!snapshotProtections.reliable) {
    for (const release of inventory.releases) {
      addProtectionReason(protectedReleaseReasons, release.releaseId, 'activation_state_unreliable');
    }
  }

  const candidates = inventory.releases
    .filter((release) => !protectedReleaseReasons.has(release.releaseId))
    .sort((left, right) => right.timestampMs - left.timestampMs || right.releaseId.localeCompare(left.releaseId));
  candidates.forEach((release, index) => {
    const ageMs = Math.max(0, nowMs - release.timestampMs);
    if (index < policy.minimumRetainedUnprotectedReleases) {
      addProtectionReason(protectedReleaseReasons, release.releaseId, 'minimum_retained_unprotected_release');
    } else if (ageMs < policy.unprotectedReleaseRetentionMs) {
      addProtectionReason(protectedReleaseReasons, release.releaseId, 'recent_unprotected_release');
    }
  });

  const keptReleases = [];
  const removableReleases = [];
  for (const release of inventory.releases) {
    const reasons = protectedReleaseReasons.get(release.releaseId);
    const record = deepFreeze({
      releaseId: release.releaseId,
      sourceSha: release.sourceSha,
      path: release.path,
      builtAtUtc: release.builtAtUtc,
      protected: Boolean(reasons),
      reasons: deepFreeze(reasons ? [...reasons].sort() : ['old_unprotected_release']),
    });
    if (reasons) keptReleases.push(release);
    else removableReleases.push(record);
  }

  const dependencyProtectionComplete = snapshotProtections.reliable && inventory.invalid.length === 0;
  const dependencies = inspectDependencyGarbage({
    layout,
    keptReleases,
    policy,
    nowMs,
    dependencyProtectionComplete,
  });
  const keptReleaseIds = new Set(keptReleases.map((release) => release.releaseId));
  const staging = inspectStagingGarbage({
    paths,
    policy,
    nowMs,
    warnings,
  });
  const sourceMaps = inspectSourceMapGarbage({
    layout,
    keptReleaseIds,
    policy,
    nowMs,
    warnings,
  });

  return deepFreeze({
    schemaVersion: 1,
    capturedAtUtc,
    layout,
    policy,
    activationStateReliable: snapshotProtections.reliable,
    dependencyProtectionComplete,
    warnings: deepFreeze(warnings),
    releases: deepFreeze({
      kept: deepFreeze(inventory.releases
        .filter((release) => protectedReleaseReasons.has(release.releaseId))
        .map((release) => deepFreeze({
          releaseId: release.releaseId,
          sourceSha: release.sourceSha,
          path: release.path,
          builtAtUtc: release.builtAtUtc,
          reasons: deepFreeze([...protectedReleaseReasons.get(release.releaseId)].sort()),
        }))),
      removable: deepFreeze(removableReleases),
      invalid: deepFreeze(inventory.invalid),
    }),
    dependencies,
    activationSnapshots: snapshotProtections.activationSnapshots,
    staging,
    sourceMaps,
  });
};

const fsyncDirectory = (directoryPath) => {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directoryPath, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const removeSafeDirectoryTree = ({ targetPath, trustedParent, label }) => {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedParent = path.resolve(trustedParent);
  if (!isWithin(resolvedParent, resolvedTarget) || pathsEqual(resolvedParent, resolvedTarget)) {
    fail(`${label} deletion target escapes or equals its trusted parent`);
  }
  const stat = lstatSync(resolvedTarget, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} deletion target is not a real directory`);
  if (!pathsEqual(realpathSync.native(resolvedTarget), resolvedTarget)) {
    fail(`${label} deletion target resolves through a link`);
  }
  rmSync(resolvedTarget, { recursive: true, force: false });
  fsyncDirectory(resolvedParent);
  return deepFreeze({ path: resolvedTarget, removed: true });
};

const removeSafeRegularFile = ({ targetPath, trustedParent, label }) => {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedParent = path.resolve(trustedParent);
  if (!isWithin(resolvedParent, resolvedTarget) || pathsEqual(resolvedParent, resolvedTarget)) {
    fail(`${label} deletion target escapes or equals its trusted parent`);
  }
  const stat = lstatSync(resolvedTarget, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} deletion target is not a real file`);
  if (!pathsEqual(realpathSync.native(resolvedTarget), resolvedTarget)) {
    fail(`${label} deletion target resolves through a link`);
  }
  unlinkSync(resolvedTarget);
  fsyncDirectory(resolvedParent);
  return deepFreeze({ path: resolvedTarget, removed: true });
};

export const runManagedReleaseGarbageCollection = ({
  trustedLayout = PRODUCTION_RELEASE_LAYOUT,
  paths = HOST_DEPLOY_PATHS,
  policy = DEFAULT_RELEASE_GARBAGE_COLLECTION_POLICY,
  currentLinkPaths = PRODUCTION_CURRENT_RELEASE_LINKS,
  protectedReleaseIds = [],
  now = () => new Date(),
  dryRun = false,
} = {}) => {
  const plan = planManagedReleaseGarbageCollection({
    trustedLayout,
    paths,
    policy,
    currentLinkPaths,
    protectedReleaseIds,
    now,
  });
  const removed = {
    releases: [],
    dependencies: Object.fromEntries(COMPONENT_NAMES.map((component) => [component, []])),
    partialDependencies: Object.fromEntries(COMPONENT_NAMES.map((component) => [component, []])),
    activationSnapshots: [],
    staging: [],
    sourceMaps: [],
  };
  if (!dryRun) {
    for (const snapshot of plan.activationSnapshots.removable) {
      removed.activationSnapshots.push(removeSafeRegularFile({
        targetPath: snapshot.path,
        trustedParent: paths.stateRoot,
        label: `Activation snapshot ${snapshot.name}`,
      }));
    }
    for (const release of plan.releases.removable) {
      removed.releases.push(removeSafeDirectoryTree({
        targetPath: release.path,
        trustedParent: plan.layout.releasesRoot,
        label: `Release ${release.releaseId}`,
      }));
    }
    for (const component of COMPONENT_NAMES) {
      const componentRoot = path.join(plan.layout.dependenciesRoot, component);
      for (const layer of plan.dependencies[component].removable) {
        removed.dependencies[component].push(removeSafeDirectoryTree({
          targetPath: layer.path,
          trustedParent: componentRoot,
          label: `${component} dependency layer ${layer.name}`,
        }));
      }
      for (const layer of plan.dependencies[component].stalePartials) {
        removed.partialDependencies[component].push(removeSafeDirectoryTree({
          targetPath: layer.path,
          trustedParent: componentRoot,
          label: `${component} partial dependency layer ${layer.name}`,
        }));
      }
    }
    for (const stagingDirectory of plan.staging.removable) {
      removed.staging.push(removeSafeDirectoryTree({
        targetPath: stagingDirectory.path,
        trustedParent: plan.staging.root,
        label: `Staging directory ${stagingDirectory.name}`,
      }));
    }
    for (const sourceMapDirectory of plan.sourceMaps.removable) {
      removed.sourceMaps.push(removeSafeDirectoryTree({
        targetPath: sourceMapDirectory.path,
        trustedParent: plan.sourceMaps.root,
        label: `Source-map directory ${sourceMapDirectory.releaseId}`,
      }));
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    dryRun,
    plannedAtUtc: plan.capturedAtUtc,
    plan,
    removed: deepFreeze({
      releases: deepFreeze(removed.releases),
      dependencies: deepFreeze(Object.fromEntries(COMPONENT_NAMES.map((component) => [
        component,
        deepFreeze(removed.dependencies[component]),
      ]))),
      partialDependencies: deepFreeze(Object.fromEntries(COMPONENT_NAMES.map((component) => [
        component,
        deepFreeze(removed.partialDependencies[component]),
      ]))),
      activationSnapshots: deepFreeze(removed.activationSnapshots),
      staging: deepFreeze(removed.staging),
      sourceMaps: deepFreeze(removed.sourceMaps),
    }),
  });
};

const verifyRelease = ({ expectedReleaseId, expectedSourceSha, trustedLayout, linkState }) => {
  if (typeof expectedReleaseId !== 'string' || !RELEASE_ID_PATTERN.test(expectedReleaseId)) {
    fail('Trusted expected release ID is invalid');
  }
  if (typeof expectedSourceSha !== 'string' || !SOURCE_SHA_PATTERN.test(expectedSourceSha)) {
    fail('Trusted expected source SHA is invalid');
  }
  const layout = validateTrustedLayout(trustedLayout);
  const uid = ownerUid();
  const trustedDirectory = (target, label) => assertRealDirectory(target, label, {
    ownerUid: uid,
    trustedRoot: layout.trustedRoot,
  });
  trustedDirectory(layout.releasesRoot, 'Release root');
  trustedDirectory(layout.dependenciesRoot, 'Dependency root');
  trustedDirectory(path.join(layout.dependenciesRoot, 'backend'), 'Backend dependency root');
  trustedDirectory(path.join(layout.dependenciesRoot, 'ui-server'), 'UI-server dependency root');
  trustedDirectory(layout.npmCacheRoot, 'npm cache root');
  trustedDirectory(layout.puppeteerCacheRoot, 'Puppeteer cache root');
  trustedDirectory(layout.persistentRoot, 'Persistent state root');
  trustedDirectory(layout.installerHomeRoot, 'Dependency installer home');
  const releaseRoot = path.join(layout.releasesRoot, expectedReleaseId);
  if (!isWithin(layout.releasesRoot, releaseRoot)) fail('Derived release directory escapes the fixed release root');
  trustedDirectory(releaseRoot, 'Extracted release directory');

  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const manifestRead = readStableRegularFile(manifestPath, 'Release manifest', {
    maximumBytes: RELEASE_LIMITS.maxManifestBytes,
    captureBytes: true,
  });
  const manifestSnapshot = manifestRead.snapshot;
  const manifestBytes = manifestRead.data;
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Release manifest is invalid JSON: ${error.message}`, { cause: error });
  }
  if (!manifestBytes.equals(serializeReleaseManifest(manifest))) fail('Release manifest is not canonical JSON');
  const { totalBytes } = validateManifestIdentity({ manifest, expectedReleaseId, expectedSourceSha });

  const dependencies = deepFreeze(Object.fromEntries(COMPONENT_NAMES.map((component) => [
    component,
    dependencyPlan({
      component,
      releaseRoot,
      lockHash: manifest.lockfiles[LOCKFILE_BY_COMPONENT[component]],
      packageHash: manifest.files.find((file) => file.path === PACKAGE_FILE_BY_COMPONENT[component]).sha256,
      toolchain: manifest.toolchain,
      layout,
    }),
  ])));
  const managedLinks = buildManagedLinks({ releaseRoot, dependencies, layout });
  const expectedLinks = new Map(managedLinks.map((entry) => [entry.relativePath, entry]));
  const tree = walkReleaseTree(releaseRoot);
  const manifestPaths = manifest.files.map((file) => file.path);
  const expectedFiles = new Set([...manifestPaths, 'release-manifest.json']);
  assertSameSet(tree.files, expectedFiles, 'Extracted release file inventory');
  assertSameSet(tree.directories, expectedDirectorySet(expectedFiles), 'Extracted release directory inventory');

  let observedLinkState;
  if (tree.links.size === 0) observedLinkState = 'unlinked';
  else if (tree.links.size === expectedLinks.size
      && [...tree.links].every((entry) => expectedLinks.has(entry))) observedLinkState = 'prepared';
  else observedLinkState = 'partial';
  if (linkState === 'unlinked') {
    if (tree.links.size !== 0) fail('Unprepared release contains a symbolic link');
  } else if (linkState === 'prepared') {
    assertSameSet(tree.links, new Set(expectedLinks.keys()), 'Prepared release managed-link inventory');
  } else if (linkState === 'auto') {
    if (observedLinkState === 'partial') fail('Release has a partial managed-link state requiring recovery');
  } else {
    fail('Release link-state expectation is invalid');
  }

  const snapshots = [];
  for (const file of manifest.files) {
    const absolutePath = path.join(releaseRoot, ...file.path.split('/'));
    if (!isWithin(releaseRoot, absolutePath)) fail(`Manifest payload escapes the release: ${file.path}`);
    const snapshot = snapshotRegularFile(absolutePath, `Release payload ${file.path}`);
    if (snapshot.size !== file.size || snapshot.sha256 !== file.sha256) {
      fail(`Release payload does not match the verified manifest: ${file.path}`);
    }
    snapshots.push({ path: file.path, ...snapshot });
  }
  snapshots.push({ path: 'release-manifest.json', ...manifestSnapshot });
  snapshots.sort((left, right) => left.path.localeCompare(right.path));

  for (const component of COMPONENT_NAMES) {
    const lockRelativePath = LOCKFILE_BY_COMPONENT[component];
    const declaredFile = manifest.files.find((file) => file.path === lockRelativePath);
    if (declaredFile.sha256 !== dependencies[component].lockHash) {
      fail(`Runtime lockfile hash disagrees with the manifest lock inventory: ${lockRelativePath}`);
    }
  }

  const finalTree = walkReleaseTree(releaseRoot);
  assertSameSet(finalTree.files, tree.files, 'Release file inventory changed during verification');
  assertSameSet(finalTree.directories, tree.directories, 'Release directory inventory changed during verification');
  assertSameSet(finalTree.links, tree.links, 'Release link inventory changed during verification');

  return {
    layout,
    releaseRoot,
    manifest,
    manifestSha256: manifestSnapshot.sha256,
    snapshotSha256: snapshotFingerprint(snapshots),
    payloadFileCount: manifest.fileCount,
    payloadBytes: totalBytes,
    dependencies,
    managedLinks,
    linkState: observedLinkState,
  };
};

export const createReleasePreparationPlan = ({
  expectedReleaseId,
  expectedSourceSha,
  trustedLayout = PRODUCTION_RELEASE_LAYOUT,
  linkState = 'unlinked',
}) => {
  const verified = verifyRelease({
    expectedReleaseId,
    expectedSourceSha,
    trustedLayout,
    linkState,
  });
  const base = {
    schemaVersion: PREPARATION_PLAN_SCHEMA_VERSION,
    releaseId: expectedReleaseId,
    sourceSha: expectedSourceSha,
    releaseRoot: verified.releaseRoot,
    manifestSha256: verified.manifestSha256,
    snapshotSha256: verified.snapshotSha256,
    payloadFileCount: verified.payloadFileCount,
    payloadBytes: verified.payloadBytes,
    layout: verified.layout,
    dependencies: verified.dependencies,
    managedLinks: verified.managedLinks,
  };
  return deepFreeze({ ...base, planSha256: canonicalDigest(base) });
};

const requirePlan = (plan) => {
  sameKeys(plan, [
    'schemaVersion',
    'releaseId',
    'sourceSha',
    'releaseRoot',
    'manifestSha256',
    'snapshotSha256',
    'payloadFileCount',
    'payloadBytes',
    'layout',
    'dependencies',
    'managedLinks',
    'planSha256',
  ], 'release preparation plan');
  const { planSha256, ...base } = plan;
  if (plan.schemaVersion !== PREPARATION_PLAN_SCHEMA_VERSION
      || !SHA256_PATTERN.test(planSha256)
      || canonicalDigest(base) !== planSha256) {
    fail('Release preparation plan is not canonically self-bound');
  }
  return plan;
};

export const serializeReleasePreparationPlan = (plan) => {
  requirePlan(plan);
  return canonicalBytes(plan);
};

const parseCanonicalDocument = (bytes, label, maximumBytes = 256 * 1024) => {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumBytes) {
    fail(`${label} has an invalid byte length`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON`, { cause: error });
  }
  if (!canonicalBytes(value).equals(bytes)) fail(`${label} is not canonical JSON`);
  return value;
};

export const loadReleasePreparationPlan = ({
  bytes,
  expectedReleaseId,
  expectedSourceSha,
  trustedLayout = PRODUCTION_RELEASE_LAYOUT,
}) => {
  const persisted = parseCanonicalDocument(bytes, 'Persisted release preparation plan');
  requirePlan(persisted);
  if (persisted.releaseId !== expectedReleaseId || persisted.sourceSha !== expectedSourceSha) {
    fail('Persisted release preparation plan does not match trusted request identity');
  }
  const verified = verifyRelease({
    expectedReleaseId,
    expectedSourceSha,
    trustedLayout,
    linkState: 'auto',
  });
  const base = {
    schemaVersion: PREPARATION_PLAN_SCHEMA_VERSION,
    releaseId: expectedReleaseId,
    sourceSha: expectedSourceSha,
    releaseRoot: verified.releaseRoot,
    manifestSha256: verified.manifestSha256,
    snapshotSha256: verified.snapshotSha256,
    payloadFileCount: verified.payloadFileCount,
    payloadBytes: verified.payloadBytes,
    layout: verified.layout,
    dependencies: verified.dependencies,
    managedLinks: verified.managedLinks,
  };
  const rebuilt = deepFreeze({ ...base, planSha256: canonicalDigest(base) });
  if (!canonicalBytes(rebuilt).equals(bytes)) {
    fail('Persisted release preparation plan does not match the verified release and host layout');
  }
  return rebuilt;
};

export const assertReleaseSnapshotUnchanged = (plan, { linkState = 'unlinked' } = {}) => {
  requirePlan(plan);
  const current = verifyRelease({
    expectedReleaseId: plan.releaseId,
    expectedSourceSha: plan.sourceSha,
    trustedLayout: plan.layout,
    linkState,
  });
  if (current.manifestSha256 !== plan.manifestSha256
      || current.snapshotSha256 !== plan.snapshotSha256) {
    fail('Verified release manifest or payload changed during preparation');
  }
  return true;
};

const assertExactLink = (entry) => {
  const before = lstatSync(entry.linkPath, { bigint: true });
  if (!before.isSymbolicLink()) fail(`Managed release path is not a symbolic link: ${entry.relativePath}`);
  const uid = ownerUid();
  if (uid !== null && process.platform !== 'win32' && before.uid !== BigInt(uid)) {
    fail(`Managed release link is not owned by the deployment process user: ${entry.relativePath}`);
  }
  const rawTarget = readlinkSync(entry.linkPath);
  if (!path.isAbsolute(rawTarget) || !pathsEqual(rawTarget, entry.targetPath)) {
    fail(`Managed release link has an unexpected target: ${entry.relativePath}`);
  }
  const targetBefore = lstatSync(entry.targetPath, { bigint: true });
  if (targetBefore.isSymbolicLink()
      || (entry.targetType === 'directory' ? !targetBefore.isDirectory() : !targetBefore.isFile())) {
    fail(`Managed release link target has the wrong type: ${entry.relativePath}`);
  }
  if (uid !== null && process.platform !== 'win32' && targetBefore.uid !== BigInt(uid)) {
    fail(`Managed release link target is not owned by the deployment process user: ${entry.relativePath}`);
  }
  if (process.platform !== 'win32' && (Number(targetBefore.mode) & 0o022) !== 0) {
    fail(`Managed release link target is group- or world-writable: ${entry.relativePath}`);
  }
  if (!pathsEqual(realpathSync.native(entry.targetPath), entry.targetPath)) {
    fail(`Managed release link target resolves through another link: ${entry.relativePath}`);
  }
  const targetAfter = lstatSync(entry.targetPath, { bigint: true });
  const after = lstatSync(entry.linkPath, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs
      || targetBefore.dev !== targetAfter.dev || targetBefore.ino !== targetAfter.ino
      || targetBefore.ctimeNs !== targetAfter.ctimeNs) {
    fail(`Managed release link or target changed during validation: ${entry.relativePath}`);
  }
};

export const prepareReleaseManagedLinks = (plan) => {
  requirePlan(plan);
  for (const component of COMPONENT_NAMES) validateDependencyLayer(plan.dependencies[component]);

  for (const entry of plan.managedLinks) {
    assertTrustedParent(entry.linkPath, `Managed release link ${entry.relativePath}`, {
      trustedRoot: plan.layout.trustedRoot,
    });
    assertTrustedPathChain(entry.targetPath, `Managed release link target ${entry.relativePath}`, {
      expectedLeafType: entry.targetType,
      owner: ownerUid(),
      trustedRoot: plan.layout.trustedRoot,
    });
  }

  const created = [];
  const reused = [];
  for (const entry of plan.managedLinks) {
    if (pathEntryExists(entry.linkPath)) {
      assertExactLink(entry);
      reused.push(entry.relativePath);
      continue;
    }
    symlinkSync(
      entry.targetPath,
      entry.linkPath,
      entry.targetType === 'directory' ? 'junction' : 'file',
    );
    assertExactLink(entry);
    fsyncDirectory(path.dirname(entry.linkPath));
    created.push(entry.relativePath);
  }
  validatePreparedReleaseLinks(plan);
  return deepFreeze({
    releaseId: plan.releaseId,
    linkCount: plan.managedLinks.length,
    created: deepFreeze(created),
    reused: deepFreeze(reused),
  });
};

export const validatePreparedReleaseLinks = (plan) => {
  requirePlan(plan);
  assertReleaseSnapshotUnchanged(plan, { linkState: 'prepared' });
  for (const component of COMPONENT_NAMES) validateDependencyLayer(plan.dependencies[component]);
  for (const entry of plan.managedLinks) assertExactLink(entry);
  return true;
};

const assertControlledDependencyEntry = (stat, relativePath, type) => {
  const uid = ownerUid();
  if (uid !== null && process.platform !== 'win32' && stat.uid !== BigInt(uid)) {
    fail(`Dependency ${type} is not owned by the deployment process user: ${relativePath}`);
  }
  // POSIX symlink mode bits are always reported as writable and are ignored by
  // the kernel. Their owner and resolved in-tree target are enforced instead.
  if (type !== 'symlink' && process.platform !== 'win32' && (Number(stat.mode) & 0o022) !== 0) {
    fail(`Dependency ${type} is group- or world-writable: ${relativePath}`);
  }
};

const createDependencyTreeSeal = (layerRoot, { trustedRoot = path.parse(layerRoot).root } = {}) => {
  assertRealDirectory(layerRoot, 'Dependency layer root', {
    ownerUid: ownerUid(),
    trustedRoot,
  });
  const records = [];
  let totalFileBytes = 0;
  const addRecord = (record, relativePath) => {
    const encodedPathBytes = Buffer.byteLength(relativePath, 'utf8');
    if (encodedPathBytes === 0 || encodedPathBytes > DEPENDENCY_TREE_LIMITS.maxRelativePathBytes) {
      fail(`Dependency entry path is outside the bounded path limit: ${relativePath}`);
    }
    records.push({ relativePath, record });
    if (records.length > DEPENDENCY_TREE_LIMITS.maxEntries) {
      fail(`Dependency tree exceeds the ${DEPENDENCY_TREE_LIMITS.maxEntries}-entry limit`);
    }
  };
  const visit = (absoluteDirectory, relativeDirectory, depth) => {
    if (depth > DEPENDENCY_TREE_LIMITS.maxDepth) {
      fail(`Dependency tree exceeds the ${DEPENDENCY_TREE_LIMITS.maxDepth}-level depth limit`);
    }
    for (const name of readdirSync(absoluteDirectory).sort()) {
      const absolutePath = path.join(absoluteDirectory, name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      assertSafeRelativePath(relativePath, 'dependency tree path');
      if (relativePath === DEPENDENCY_MARKER_FILE) continue;
      const stat = lstatSync(absolutePath, { bigint: true });
      if (stat.isSymbolicLink()) {
        if (stat.nlink !== 1n) fail(`Dependency symlink has multiple hard links: ${relativePath}`);
        assertControlledDependencyEntry(stat, relativePath, 'symlink');
        const rawTarget = readlinkSync(absolutePath);
        if (path.isAbsolute(rawTarget)) {
          fail(`Dependency symlink must use a relocatable relative target: ${relativePath}`);
        }
        const lexicalTarget = path.resolve(path.dirname(absolutePath), rawTarget);
        if (!isWithin(layerRoot, lexicalTarget)) {
          fail(`Dependency symlink escapes its dependency layer: ${relativePath}`);
        }
        let resolvedTarget;
        try {
          resolvedTarget = realpathSync.native(absolutePath);
        } catch (error) {
          throw new Error(`Dependency symlink target is missing or invalid: ${relativePath}`, { cause: error });
        }
        if (!isWithin(layerRoot, resolvedTarget)) {
          fail(`Dependency symlink resolves outside its dependency layer: ${relativePath}`);
        }
        const after = lstatSync(absolutePath, { bigint: true });
        if (after.dev !== stat.dev || after.ino !== stat.ino || after.ctimeNs !== stat.ctimeNs) {
          fail(`Dependency symlink changed during sealing: ${relativePath}`);
        }
        addRecord(['symlink', relativePath, rawTarget], relativePath);
      } else if (stat.isDirectory()) {
        assertControlledDependencyEntry(stat, relativePath, 'directory');
        addRecord(['directory', relativePath, Number(stat.mode) & 0o777], relativePath);
        visit(absolutePath, relativePath, depth + 1);
        const after = lstatSync(absolutePath, { bigint: true });
        if (!after.isDirectory() || after.dev !== stat.dev || after.ino !== stat.ino) {
          fail(`Dependency directory changed during sealing: ${relativePath}`);
        }
      } else if (stat.isFile()) {
        if (stat.nlink !== 1n) fail(`Dependency file has multiple hard links: ${relativePath}`);
        assertControlledDependencyEntry(stat, relativePath, 'file');
        const snapshot = snapshotRegularFile(absolutePath, `Dependency file ${relativePath}`, {
          maximumBytes: DEPENDENCY_TREE_LIMITS.maxFileBytes,
        });
        totalFileBytes += snapshot.size;
        if (!Number.isSafeInteger(totalFileBytes)
            || totalFileBytes > DEPENDENCY_TREE_LIMITS.maxTotalBytes) {
          fail(`Dependency tree exceeds the ${DEPENDENCY_TREE_LIMITS.maxTotalBytes}-byte limit`);
        }
        addRecord([
          'file',
          relativePath,
          Number(stat.mode) & 0o777,
          snapshot.size,
          snapshot.sha256,
        ], relativePath);
      } else {
        fail(`Dependency tree contains a special file: ${relativePath}`);
      }
    }
  };
  visit(layerRoot, '', 1);
  records.sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));
  const hash = createHash('sha256');
  for (const { record } of records) hash.update(`${JSON.stringify(record)}\n`, 'utf8');
  return deepFreeze({
    algorithm: 'sha256',
    digest: hash.digest('hex'),
    entryCount: records.length,
    fileBytes: totalFileBytes,
  });
};

const dependencyMarkerBytes = (dependency, treeSeal) => Buffer.from(`${JSON.stringify({
  schemaVersion: 2,
  component: dependency.component,
  layerKey: dependency.layerKey,
  material: dependency.material,
  tree: treeSeal,
}, null, 2)}\n`, 'utf8');

const validateDependencyLayer = (dependency) => {
  const stat = lstatSync(dependency.finalPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`Existing ${dependency.component} dependency layer is not a real directory`);
  }
  if (!pathsEqual(realpathSync.native(dependency.finalPath), dependency.finalPath)) {
    fail(`Existing ${dependency.component} dependency layer resolves through a link`);
  }
  assertTrustedPathChain(dependency.finalPath, `${dependency.component} dependency layer`, {
    expectedLeafType: 'directory',
    owner: ownerUid(),
    trustedRoot: dependency.trustedRoot,
  });
  assertControlledDependencyEntry(stat, '.', 'directory');
  const entries = readdirSync(dependency.finalPath).sort();
  if (JSON.stringify(entries) !== JSON.stringify([
    DEPENDENCY_MARKER_FILE,
    'node_modules',
    'package-lock.json',
    'package.json',
  ])) {
    fail(`Existing ${dependency.component} dependency layer has unexpected or missing entries`);
  }
  const nodeModulesStat = lstatSync(dependency.nodeModulesPath);
  if (!nodeModulesStat.isDirectory() || nodeModulesStat.isSymbolicLink()) {
    fail(`Existing ${dependency.component} node_modules is not a real directory`);
  }
  const lockSnapshot = snapshotRegularFile(
    path.join(dependency.finalPath, dependency.lockFileName),
    `${dependency.component} dependency lockfile`,
  );
  if (lockSnapshot.sha256 !== dependency.lockHash) {
    fail(`Existing ${dependency.component} dependency layer has the wrong lockfile hash`);
  }
  const packageSnapshot = snapshotRegularFile(
    path.join(dependency.finalPath, dependency.packageFileName),
    `${dependency.component} dependency package file`,
  );
  if (packageSnapshot.sha256 !== dependency.packageHash) {
    fail(`Existing ${dependency.component} dependency layer has the wrong package file hash`);
  }
  const treeSeal = createDependencyTreeSeal(dependency.finalPath, { trustedRoot: dependency.trustedRoot });
  const expectedMarker = dependencyMarkerBytes(dependency, treeSeal);
  const markerRead = readStableRegularFile(
    path.join(dependency.finalPath, DEPENDENCY_MARKER_FILE),
    `${dependency.component} dependency marker`,
    { maximumBytes: 4096, captureBytes: true },
  );
  if (!markerRead.data.equals(expectedMarker)) {
    fail(`Existing ${dependency.component} dependency layer has an invalid publication marker`);
  }
  return true;
};

const dependencyPartialMarkerBytes = (plan, dependency) => canonicalBytes({
  schemaVersion: 1,
  planSha256: plan.planSha256,
  component: dependency.component,
  layerKey: dependency.layerKey,
  material: dependency.material,
});

const validateRecoverablePartialLayer = (plan, dependency) => {
  assertRealDirectory(dependency.partialPath, `Partial ${dependency.component} dependency layer`, {
    ownerUid: ownerUid(),
    trustedRoot: dependency.trustedRoot,
  });
  const entries = readdirSync(dependency.partialPath).sort();
  const allowed = new Set([
    DEPENDENCY_PARTIAL_MARKER_FILE,
    'node_modules',
    dependency.lockFileName,
    dependency.packageFileName,
  ]);
  if (!entries.every((entry) => allowed.has(entry))
      || !entries.includes(DEPENDENCY_PARTIAL_MARKER_FILE)
      || !entries.includes(dependency.lockFileName)
      || !entries.includes(dependency.packageFileName)) {
    fail(`Partial ${dependency.component} dependency layer is not restart-safe`);
  }
  const marker = readStableRegularFile(
    path.join(dependency.partialPath, DEPENDENCY_PARTIAL_MARKER_FILE),
    `${dependency.component} partial dependency marker`,
    { maximumBytes: 8192, captureBytes: true },
  );
  if (!marker.data.equals(dependencyPartialMarkerBytes(plan, dependency))) {
    fail(`Partial ${dependency.component} dependency layer belongs to another preparation plan`);
  }
  const lock = snapshotRegularFile(
    path.join(dependency.partialPath, dependency.lockFileName),
    `${dependency.component} partial dependency lockfile`,
  );
  const packageFile = snapshotRegularFile(
    path.join(dependency.partialPath, dependency.packageFileName),
    `${dependency.component} partial dependency package file`,
  );
  if (lock.sha256 !== dependency.lockHash || packageFile.sha256 !== dependency.packageHash) {
    fail(`Partial ${dependency.component} dependency inputs are not restart-safe`);
  }
  if (entries.includes('node_modules')) {
    const modules = lstatSync(path.join(dependency.partialPath, 'node_modules'), { bigint: true });
    if (!modules.isDirectory() || modules.isSymbolicLink()) {
      fail(`Partial ${dependency.component} node_modules is unsafe`);
    }
  }
  return true;
};

const inspectDependencyPhase = (plan, component) => {
  const dependency = plan.dependencies[component];
  assertRealDirectory(dependency.componentRoot, `${component} dependency root`, {
    ownerUid: ownerUid(),
    trustedRoot: dependency.trustedRoot,
  });
  const hasPartial = pathEntryExists(dependency.partialPath);
  const hasFinal = pathEntryExists(dependency.finalPath);
  if (hasPartial && hasFinal) fail(`${component} dependency has both partial and published state`);
  if (hasFinal) {
    validateDependencyLayer(dependency);
    return 'prepared';
  }
  if (hasPartial) {
    validateRecoverablePartialLayer(plan, dependency);
    return 'partial';
  }
  assertTrustedParent(dependency.partialPath, `${component} dependency partial`, {
    trustedRoot: dependency.trustedRoot,
  });
  assertTrustedParent(dependency.finalPath, `${component} dependency final`, {
    trustedRoot: dependency.trustedRoot,
  });
  return 'unlinked';
};

export const inspectDependencyPublicationState = (plan) => {
  requirePlan(plan);
  assertReleaseSnapshotUnchanged(plan, { linkState: 'auto' });
  const result = {};
  for (const component of COMPONENT_NAMES) {
    const phase = inspectDependencyPhase(plan, component);
    result[component] = phase === 'prepared' ? 'reuse' : (phase === 'partial' ? 'resume' : 'install');
  }
  return deepFreeze(result);
};

const requireCanonicalUtc = (value, label) => {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || Number.isNaN(Date.parse(value))
      || new Date(value).toISOString() !== value) fail(`${label} is invalid`);
  return value;
};

export const inspectReleasePreparationState = (plan, { now = () => new Date() } = {}) => {
  requirePlan(plan);
  const verified = verifyRelease({
    expectedReleaseId: plan.releaseId,
    expectedSourceSha: plan.sourceSha,
    trustedLayout: plan.layout,
    linkState: 'auto',
  });
  if (verified.manifestSha256 !== plan.manifestSha256
      || verified.snapshotSha256 !== plan.snapshotSha256) {
    fail('Verified release changed while inspecting preparation state');
  }
  const dependencies = Object.fromEntries(
    COMPONENT_NAMES.map((component) => [component, inspectDependencyPhase(plan, component)]),
  );
  let phase = 'partial';
  if (verified.linkState === 'unlinked'
      && COMPONENT_NAMES.every((component) => dependencies[component] === 'unlinked')) phase = 'unlinked';
  if (verified.linkState === 'prepared'
      && COMPONENT_NAMES.every((component) => dependencies[component] === 'prepared')) phase = 'prepared';
  const capturedAtUtc = now().toISOString();
  requireCanonicalUtc(capturedAtUtc, 'Preparation state timestamp');
  return deepFreeze({
    schemaVersion: PREPARATION_STATE_SCHEMA_VERSION,
    planSha256: plan.planSha256,
    releaseId: plan.releaseId,
    sourceSha: plan.sourceSha,
    phase,
    releaseLinks: verified.linkState,
    dependencies: deepFreeze(dependencies),
    capturedAtUtc,
  });
};

const requirePreparationState = (state, plan) => {
  sameKeys(state, [
    'schemaVersion',
    'planSha256',
    'releaseId',
    'sourceSha',
    'phase',
    'releaseLinks',
    'dependencies',
    'capturedAtUtc',
  ], 'release preparation state');
  sameKeys(state.dependencies, COMPONENT_NAMES, 'release preparation dependency state');
  if (state.schemaVersion !== PREPARATION_STATE_SCHEMA_VERSION
      || state.planSha256 !== plan.planSha256
      || state.releaseId !== plan.releaseId
      || state.sourceSha !== plan.sourceSha
      || !['unlinked', 'partial', 'prepared'].includes(state.phase)
      || !['unlinked', 'prepared'].includes(state.releaseLinks)
      || !COMPONENT_NAMES.every((component) => (
        ['unlinked', 'partial', 'prepared'].includes(state.dependencies[component])
      ))) fail('Release preparation state is invalid or belongs to another plan');
  requireCanonicalUtc(state.capturedAtUtc, 'Release preparation state timestamp');
  return state;
};

export const serializeReleasePreparationState = (state, plan) => {
  requirePlan(plan);
  requirePreparationState(state, plan);
  return canonicalBytes(state);
};

export const loadReleasePreparationState = ({ bytes, plan }) => {
  requirePlan(plan);
  const state = parseCanonicalDocument(bytes, 'Persisted release preparation state', 64 * 1024);
  requirePreparationState(state, plan);
  return deepFreeze(state);
};

export const reconcileReleasePreparationState = ({ persistedState, plan, now }) => {
  requirePreparationState(persistedState, plan);
  const current = inspectReleasePreparationState(plan, { now });
  return deepFreeze({
    persisted: persistedState,
    current,
    actions: deepFreeze(COMPONENT_NAMES.map((component) => ({
      component,
      action: current.dependencies[component] === 'prepared'
        ? 'reuse'
        : (current.dependencies[component] === 'partial' ? 'resume-install' : 'install'),
    }))),
  });
};

const toCapacity = (value, label) => {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  fail(`${label} must be a non-negative safe integer or bigint`);
};

const parseCapacityPair = (value, label) => {
  sameKeys(value, ['bytes', 'inodes'], label);
  return {
    bytes: toCapacity(value.bytes, `${label} bytes`),
    inodes: toCapacity(value.inodes, `${label} inodes`),
  };
};

const publicationStateKey = (publicationState) =>
  COMPONENT_NAMES.map((component) => `${component}:${publicationState[component]}`).join('|');

const normalizedCapacityBudget = (trustedBudget) => {
  sameKeys(trustedBudget, ['layers', 'caches', 'safetyMargin'], 'trusted dependency capacity budget');
  sameKeys(trustedBudget.layers, COMPONENT_NAMES, 'trusted layer capacity budget');
  sameKeys(trustedBudget.caches, ['npm', 'puppeteer'], 'trusted cache capacity budget');
  return deepFreeze({
    layers: deepFreeze(Object.fromEntries(COMPONENT_NAMES.map((component) => [
      component,
      deepFreeze(parseCapacityPair(trustedBudget.layers[component], `${component} layer capacity budget`)),
    ]))),
    caches: deepFreeze(Object.fromEntries(['npm', 'puppeteer'].map((cache) => [
      cache,
      deepFreeze(parseCapacityPair(trustedBudget.caches[cache], `${cache} cache capacity budget`)),
    ]))),
    safetyMargin: deepFreeze(parseCapacityPair(trustedBudget.safetyMargin, 'capacity safety margin')),
  });
};

const requiredCapacityPaths = (plan, publicationState) => {
  const paths = [];
  for (const component of COMPONENT_NAMES) {
    if (publicationState[component] !== 'reuse') paths.push(plan.dependencies[component].componentRoot);
  }
  if (paths.length > 0) paths.push(plan.layout.npmCacheRoot, plan.layout.puppeteerCacheRoot);
  return [...new Set(paths)].sort();
};

const parseCapacityEvidence = ({ available, targetPaths, plan, now, maxAgeMs }) => {
  sameKeys(available, ['measuredAtUtc', 'filesystems'], 'available dependency capacity evidence');
  requireCanonicalUtc(available.measuredAtUtc, 'Capacity measurement timestamp');
  if (!Array.isArray(available.filesystems)) fail('Capacity filesystem evidence must be an array');
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 5 * 60 * 1000) {
    fail('Capacity proof maximum age is invalid');
  }
  const observedAt = Date.parse(available.measuredAtUtc);
  const nowMs = now().getTime();
  if (!Number.isFinite(nowMs) || observedAt > nowMs + 1000 || nowMs - observedAt > maxAgeMs) {
    fail('Dependency capacity evidence is stale or from the future');
  }
  const expected = new Set(targetPaths);
  const records = [];
  let previous = null;
  for (const entry of available.filesystems) {
    sameKeys(entry, ['targetPath', 'device', 'availableBytes', 'availableInodes'], 'capacity filesystem evidence');
    if (typeof entry.targetPath !== 'string' || !expected.has(entry.targetPath)
        || (previous !== null && previous >= entry.targetPath)) {
      fail('Capacity filesystem paths are unexpected, duplicated, or not canonically sorted');
    }
    previous = entry.targetPath;
    if (typeof entry.device !== 'string' || !/^[0-9]+$/.test(entry.device)) {
      fail('Capacity filesystem device identity is invalid');
    }
    assertRealDirectory(entry.targetPath, `Capacity target ${entry.targetPath}`, {
      ownerUid: ownerUid(),
      trustedRoot: plan.layout.trustedRoot,
    });
    const actual = lstatSync(entry.targetPath, { bigint: true });
    if (actual.dev.toString() !== entry.device) fail(`Capacity evidence device changed: ${entry.targetPath}`);
    records.push(deepFreeze({
      targetPath: entry.targetPath,
      device: entry.device,
      availableBytes: toCapacity(entry.availableBytes, 'available dependency bytes'),
      availableInodes: toCapacity(entry.availableInodes, 'available dependency inodes'),
    }));
  }
  if (records.length !== expected.size) fail('Capacity evidence is missing one or more filesystem paths');
  return deepFreeze({
    measuredAtUtc: available.measuredAtUtc,
    expiresAtUtc: new Date(observedAt + maxAgeMs).toISOString(),
    filesystems: deepFreeze(records),
  });
};

export const calculateDependencyCapacity = ({
  plan,
  publicationState,
  trustedBudget,
  available,
  now = () => new Date(),
  maxAgeMs = CAPACITY_PROOF_MAX_AGE_MS,
}) => {
  requirePlan(plan);
  sameKeys(publicationState, COMPONENT_NAMES, 'dependency publication state');
  const observedState = inspectDependencyPublicationState(plan);
  if (publicationStateKey(observedState) !== publicationStateKey(publicationState)) {
    fail('Dependency publication state is not bound to this verified release plan');
  }
  for (const component of COMPONENT_NAMES) {
    if (!['install', 'resume', 'reuse'].includes(publicationState[component])) {
      fail(`Dependency publication state is invalid for ${component}`);
    }
  }
  const budget = normalizedCapacityBudget(trustedBudget);
  const installs = COMPONENT_NAMES.filter((component) => publicationState[component] !== 'reuse');
  const targetPaths = requiredCapacityPaths(plan, publicationState);
  const evidence = parseCapacityEvidence({ available, targetPaths, plan, now, maxAgeMs });
  const measurementByPath = new Map(evidence.filesystems.map((entry) => [entry.targetPath, entry]));
  const grouped = new Map();
  const addRequirement = (targetPath, requirement) => {
    const measurement = measurementByPath.get(targetPath);
    if (!measurement) fail(`Capacity evidence is missing required path: ${targetPath}`);
    if (!grouped.has(measurement.device)) {
      grouped.set(measurement.device, {
        device: measurement.device,
        paths: new Set(),
        availableBytes: measurement.availableBytes,
        availableInodes: measurement.availableInodes,
        requiredBytes: budget.safetyMargin.bytes,
        requiredInodes: budget.safetyMargin.inodes,
      });
    }
    const group = grouped.get(measurement.device);
    group.paths.add(targetPath);
    group.availableBytes = group.availableBytes < measurement.availableBytes
      ? group.availableBytes : measurement.availableBytes;
    group.availableInodes = group.availableInodes < measurement.availableInodes
      ? group.availableInodes : measurement.availableInodes;
    group.requiredBytes += requirement.bytes;
    group.requiredInodes += requirement.inodes;
  };
  for (const component of installs) addRequirement(plan.dependencies[component].componentRoot, budget.layers[component]);
  if (installs.length > 0) {
    addRequirement(plan.layout.npmCacheRoot, budget.caches.npm);
    addRequirement(plan.layout.puppeteerCacheRoot, budget.caches.puppeteer);
  }
  const filesystems = [...grouped.values()]
    .sort((left, right) => left.device.localeCompare(right.device))
    .map((group) => {
      const byteShortfall = group.requiredBytes > group.availableBytes
        ? group.requiredBytes - group.availableBytes : 0n;
      const inodeShortfall = group.requiredInodes > group.availableInodes
        ? group.requiredInodes - group.availableInodes : 0n;
      return deepFreeze({
        device: group.device,
        paths: deepFreeze([...group.paths].sort()),
        requiredBytes: group.requiredBytes,
        requiredInodes: group.requiredInodes,
        availableBytes: group.availableBytes,
        availableInodes: group.availableInodes,
        byteShortfall,
        inodeShortfall,
        sufficient: byteShortfall === 0n && inodeShortfall === 0n,
      });
    });
  const requiredBytes = filesystems.reduce((sum, item) => sum + item.requiredBytes, 0n);
  const requiredInodes = filesystems.reduce((sum, item) => sum + item.requiredInodes, 0n);
  const availableBytes = filesystems.reduce((sum, item) => sum + item.availableBytes, 0n);
  const availableInodes = filesystems.reduce((sum, item) => sum + item.availableInodes, 0n);
  const byteShortfall = filesystems.reduce((sum, item) => sum + item.byteShortfall, 0n);
  const inodeShortfall = filesystems.reduce((sum, item) => sum + item.inodeShortfall, 0n);
  const calculation = deepFreeze({
    schemaVersion: 1,
    planSha256: plan.planSha256,
    publicationStateKey: publicationStateKey(publicationState),
    measuredAtUtc: evidence.measuredAtUtc,
    expiresAtUtc: evidence.expiresAtUtc,
    targetPaths: deepFreeze(targetPaths),
    filesystems: deepFreeze(filesystems),
    trustedBudget: budget,
    requiredBytes,
    requiredInodes,
    availableBytes,
    availableInodes,
    byteShortfall,
    inodeShortfall,
    sufficient: filesystems.every((item) => item.sufficient),
    installs: deepFreeze([...installs]),
  });
  return calculation;
};

export const assertSufficientDependencyCapacity = (calculation) => {
  if (!calculation || calculation.schemaVersion !== 1
      || !SHA256_PATTERN.test(calculation.planSha256 ?? '')
      || calculation.sufficient !== true
      || calculation.byteShortfall !== 0n || calculation.inodeShortfall !== 0n) {
    fail('Insufficient disk bytes or inodes for dependency preparation');
  }
  return true;
};

const assertCapacityBoundToCurrentState = (calculation, plan, publicationState, now = () => new Date()) => {
  assertSufficientDependencyCapacity(calculation);
  if (calculation.planSha256 !== plan.planSha256
      || calculation.publicationStateKey !== publicationStateKey(publicationState)) {
    fail('Dependency capacity proof is stale or belongs to a different release plan');
  }
  if (now().getTime() > Date.parse(calculation.expiresAtUtc)) {
    fail('Dependency capacity proof has expired');
  }
};

const writeExclusive = (destination, bytes, mode) => {
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(
    destination,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
    mode,
  );
  try {
    writeFileSync(descriptor, bytes);
    chmodSync(destination, mode);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

export const publishDependencyLayer = async ({
  plan,
  component,
  capacityCalculation,
  executor,
}) => {
  requirePlan(plan);
  if (!COMPONENT_NAMES.includes(component)) fail('Dependency component is invalid');
  if (typeof executor !== 'function') fail('A trusted dependency executor function is required');
  const state = inspectDependencyPublicationState(plan);
  assertCapacityBoundToCurrentState(capacityCalculation, plan, state);
  const dependency = plan.dependencies[component];
  if (state[component] === 'reuse') {
    return deepFreeze({ component, status: 'reused', finalPath: dependency.finalPath });
  }

  const sourceLockRead = readStableRegularFile(
    dependency.sourceLockPath,
    `${component} release lockfile`,
    { captureBytes: true },
  );
  const sourceLockBefore = sourceLockRead.snapshot;
  if (sourceLockBefore.sha256 !== dependency.lockHash) fail(`${component} release lockfile hash changed`);
  const sourcePackageRead = readStableRegularFile(
    dependency.sourcePackagePath,
    `${component} release package file`,
    { captureBytes: true },
  );
  const sourcePackageBefore = sourcePackageRead.snapshot;

  mkdirSync(dependency.partialPath, { mode: 0o700 });
  chmodSync(dependency.partialPath, 0o700);
  writeExclusive(
    path.join(dependency.partialPath, dependency.packageFileName),
    sourcePackageRead.data,
    0o444,
  );
  writeExclusive(
    path.join(dependency.partialPath, dependency.lockFileName),
    sourceLockRead.data,
    0o444,
  );
  fsyncDirectory(dependency.partialPath);

  const execution = deepFreeze({
    executable: '/usr/bin/npm',
    args: deepFreeze([...dependency.material.installFlags]),
    cwd: dependency.partialPath,
    env: deepFreeze({
      HOME: dependency.installerHomeRoot,
      LOGNAME: INSTALL_IDENTITY_NAME,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      USER: INSTALL_IDENTITY_NAME,
      NODE_ENV: 'production',
      NPM_CONFIG_CACHE: dependency.npmCacheRoot,
      PUPPETEER_CACHE_DIR: dependency.puppeteerCacheRoot,
    }),
  });
  let result;
  try {
    result = await executor(execution);
  } catch (error) {
    throw new Error(
      `${component} dependency executor failed; partial residue was preserved for trusted cleanup: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!result || result.exitCode !== 0) {
    fail(`${component} dependency executor did not succeed; partial residue was preserved for trusted cleanup`);
  }

  assertReleaseSnapshotUnchanged(plan);
  const sourceLockAfter = snapshotRegularFile(dependency.sourceLockPath, `${component} release lockfile`);
  const sourcePackageAfter = snapshotRegularFile(dependency.sourcePackagePath, `${component} release package file`);
  if (sourceLockAfter.sha256 !== dependency.lockHash
      || sourceLockAfter.dev !== sourceLockBefore.dev
      || sourceLockAfter.ino !== sourceLockBefore.ino
      || sourcePackageAfter.sha256 !== sourcePackageBefore.sha256
      || sourcePackageAfter.dev !== sourcePackageBefore.dev
      || sourcePackageAfter.ino !== sourcePackageBefore.ino) {
    fail(`${component} release dependency inputs changed during installation; partial residue was preserved`);
  }
  const stagedLock = snapshotRegularFile(
    path.join(dependency.partialPath, dependency.lockFileName),
    `${component} staged lockfile`,
  );
  if (stagedLock.sha256 !== dependency.lockHash) {
    fail(`${component} staged lockfile changed during installation; partial residue was preserved`);
  }
  const stagedPackage = snapshotRegularFile(
    path.join(dependency.partialPath, dependency.packageFileName),
    `${component} staged package file`,
  );
  if (stagedPackage.sha256 !== sourcePackageBefore.sha256) {
    fail(`${component} staged package file changed during installation; partial residue was preserved`);
  }
  const nodeModules = path.join(dependency.partialPath, 'node_modules');
  if (!existsSync(nodeModules)) fail(`${component} dependency executor produced no node_modules; partial residue was preserved`);
  const modulesStat = lstatSync(nodeModules);
  if (!modulesStat.isDirectory() || modulesStat.isSymbolicLink()) {
    fail(`${component} dependency executor produced an unsafe node_modules; partial residue was preserved`);
  }
  const entries = readdirSync(dependency.partialPath).sort();
  if (JSON.stringify(entries) !== JSON.stringify(['node_modules', 'package-lock.json', 'package.json'])) {
    fail(`${component} dependency executor produced unexpected top-level residue`);
  }
  const treeSeal = createDependencyTreeSeal(dependency.partialPath, {
    trustedRoot: dependency.trustedRoot,
  });
  writeExclusive(
    path.join(dependency.partialPath, DEPENDENCY_MARKER_FILE),
    dependencyMarkerBytes(dependency, treeSeal),
    0o444,
  );
  if (pathEntryExists(dependency.finalPath)) fail(`${component} dependency destination appeared during installation`);
  chmodSync(dependency.partialPath, 0o755);
  fsyncDirectory(dependency.partialPath);
  renameSync(dependency.partialPath, dependency.finalPath);
  fsyncDirectory(dependency.componentRoot);
  validateDependencyLayer(dependency);
  assertReleaseSnapshotUnchanged(plan);
  return deepFreeze({ component, status: 'published', finalPath: dependency.finalPath });
};
