import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export const RELEASE_SCHEMA_VERSION = 1;
export const CANONICAL_REPOSITORY = 'pablo-dryfield/omni-lodge';
export const CANONICAL_WORKFLOW_PATH = '.github/workflows/release.yml';
export const CANONICAL_RELEASE_REF = 'refs/heads/master';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const RELEASE_ID_PATTERN = /^omnilodge-r([1-9][0-9]*)-a([1-9][0-9]*)-([0-9a-f]{12})$/;
const MEBIBYTE = 1024 * 1024;
export const RELEASE_LIMITS = Object.freeze({
  maxPayloadFileBytes: 128 * MEBIBYTE,
  maxPayloadFileCount: 20_000,
  maxPayloadTotalBytes: 512 * MEBIBYTE,
  maxManifestBytes: 8 * MEBIBYTE,
  maxUncompressedArchiveBytes: 576 * MEBIBYTE,
  maxCompressedArchiveBytes: 512 * MEBIBYTE,
  maxArchiveEntries: 100_000,
});
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const FIXED_RUNTIME_FILES = [
  'be/scripts/startMonitored.js',
  'be/package.json',
  'be/package-lock.json',
  'ui/public/assets/badges/ktk-guide-badge.svg',
  'ui/public/assets/badges/ktk-media-badge.svg',
  'ui/public/assets/badges/ktk-backside-badge.png',
  'ui-server/server.js',
  'ui-server/reportingSecurity.js',
  'ui-server/sourceMapArchive.js',
  'ui-server/telemetryPayload.js',
  'ui-server/telemetrySecurity.js',
  'ui-server/health.js',
  'ui-server/runtimeConfig.js',
  'ui-server/uiArtifactValidation.js',
  'ui-server/utils/logger.js',
  'ui-server/package.json',
  'ui-server/package-lock.json',
];

const RUNTIME_TREES = [
  ['be/dist', 'be/dist'],
  ['ui/build', 'ui/build'],
];

const RUNTIME_ENTRYPOINT_FILES = [
  'be/dist/app.js',
  'be/dist/scripts/baselineMigrations.js',
  'be/dist/scripts/runMigrations.js',
  'be/dist/scripts/syncAccessControl.js',
  'ui/build/index.html',
  'ui/build/asset-manifest.json',
  'ui/build/release-metadata.json',
  'ui/build/service-worker.js',
  'ui/build/manifest.json',
  'ui/build/pwa-manifest-selector.js',
];

export const REQUIRED_PAYLOAD_FILES = Object.freeze(
  [...new Set([...FIXED_RUNTIME_FILES, ...RUNTIME_ENTRYPOINT_FILES])].sort(compareText),
);

const LOCKFILE_PATHS = [
  'be/package-lock.json',
  'ui/package-lock.json',
  'ui-server/package-lock.json',
];

const PACKAGE_PATHS = [
  'be/package.json',
  'ui/package.json',
  'ui-server/package.json',
];

const REQUIRED_EXTERNAL_PRODUCTION_CHECKS = [
  'workflow_conclusion_success',
  'immutable_github_artifact_id',
  'authenticated_github_artifact_digest',
  'expected_release_identity',
  'protected_environment_authorization',
];

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const parseStrictCliArguments = (argv, { valueOptions = [], booleanOptions = [] }) => {
  invariant(Array.isArray(argv), 'CLI arguments must be an array');
  const allowedValues = new Set(valueOptions);
  const allowedBooleans = new Set(booleanOptions);
  invariant(
    allowedValues.size === valueOptions.length && allowedBooleans.size === booleanOptions.length,
    'CLI option allowlists cannot contain duplicates',
  );
  for (const option of allowedValues) {
    invariant(!allowedBooleans.has(option), `CLI option is declared as both value and boolean: --${option}`);
  }

  const values = {};
  const flags = new Set();
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    invariant(typeof argument === 'string' && argument.startsWith('--'), `Unexpected argument: ${argument}`);
    invariant(!argument.includes('='), `Equals-style CLI arguments are not accepted: ${argument}`);
    const key = argument.slice(2);
    invariant(key.length > 0, 'Empty CLI option is not accepted');
    invariant(allowedValues.has(key) || allowedBooleans.has(key), `Unknown CLI option: --${key}`);
    invariant(!seen.has(key), `Duplicate CLI option: --${key}`);
    seen.add(key);
    if (allowedBooleans.has(key)) {
      flags.add(key);
      continue;
    }
    const next = argv[index + 1];
    invariant(next && !next.startsWith('--'), `Missing value for --${key}`);
    values[key] = next;
    index += 1;
  }
  return { values, flags };
};

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const assertSafeRelativePath = (value, label = 'path') => {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  invariant(!value.includes('\0'), `${label} contains a null byte`);
  invariant(!value.includes('\\'), `${label} must use forward slashes`);
  invariant(!value.includes(':'), `${label} contains a platform-sensitive colon`);
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    invariant(codePoint >= 0x20 && codePoint !== 0x7f, `${label} contains a control character`);
  }
  invariant(!value.startsWith('/') && !/^[A-Za-z]:/.test(value), `${label} must be relative`);
  const candidate = value.endsWith('/') ? value.slice(0, -1) : value;
  invariant(candidate.length > 0, `${label} cannot be the archive root`);
  const segments = candidate.split('/');
  invariant(
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    `${label} contains an unsafe path segment`,
  );
  invariant(path.posix.normalize(candidate) === candidate, `${label} is not normalized`);
  return candidate;
};

const SENSITIVE_DIRECTORY_NAMES = new Set([
  '.aws',
  '.azure',
  '.direnv',
  '.docker',
  '.git',
  '.gnupg',
  '.hg',
  '.kube',
  '.ssh',
  '.svn',
  'node_modules',
  'runtime',
  'uploads',
]);

const SENSITIVE_EXACT_FILENAMES = new Set([
  '.dockercfg',
  '.envrc',
  '.git-credentials',
  '.my.cnf',
  '.netrc',
  '.npmrc',
  '.pgpass',
  '.pypirc',
  '.yarnrc',
  'application_default_credentials',
  'application_default_credentials.json',
  'authorized_keys',
  'credentials.json',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
  'kubeconfig',
  'password',
  'passwords',
  'private-key',
  'private_key',
  'secret',
  'secrets',
  'service-account.json',
  'service_account.json',
  'serviceaccount.json',
  'token',
  'tokens',
]);

const SENSITIVE_FILE_EXTENSION_PATTERN = /\.(?:bak|backup|cer|cert|crt|db|der|dump|jks|kdbx|key|keystore|kubeconfig|log|mobileprovision|ovpn|p12|pem|pfx|pk8|pkcs12|ppk|sqlite|sqlite3|tfstate|tfvars)$/i;
const SENSITIVE_DATA_FILENAME_PATTERN = /(?:^|[-_.])(?:client[-_]?secret|credentials?|firebase[-_]?adminsdk|passwords?|private[-_]?key|secrets?|service[-_]?account|tokens?)(?:[-_.].*)?\.(?:cfg|conf|config|env|ini|json|properties|toml|txt|ya?ml)$/i;
const SSH_KEY_FILENAME_PATTERN = /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\.pub)?$/i;

export const assertPayloadPathAllowed = (relativePath) => {
  assertSafeRelativePath(relativePath, 'payload path');
  const isTreeFile = relativePath.startsWith('be/dist/') || relativePath.startsWith('ui/build/');
  const isFixedFile = FIXED_RUNTIME_FILES.includes(relativePath);
  invariant(isTreeFile || isFixedFile, `Unexpected release payload path: ${relativePath}`);

  const segments = relativePath.toLowerCase().split('/');
  const forbiddenDirectory = segments.find((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment));
  invariant(!forbiddenDirectory, `Sensitive or runtime directory cannot be shipped: ${relativePath}`);

  const basename = segments.at(-1) || '';
  invariant(!/^\.env(?:\.|$)/.test(basename), `Environment files cannot be shipped: ${relativePath}`);
  invariant(!SENSITIVE_EXACT_FILENAMES.has(basename), `Credential file cannot be shipped: ${relativePath}`);
  invariant(!SSH_KEY_FILENAME_PATTERN.test(basename), `SSH key file cannot be shipped: ${relativePath}`);
  invariant(!SENSITIVE_FILE_EXTENSION_PATTERN.test(basename), `Sensitive data file cannot be shipped: ${relativePath}`);
  invariant(!SENSITIVE_DATA_FILENAME_PATTERN.test(basename), `Credential-like data file cannot be shipped: ${relativePath}`);
};

const normalizeFilesystemPath = (value) => {
  let normalized = path.normalize(path.resolve(value));
  const parsedRoot = path.parse(normalized).root;
  while (normalized.length > parsedRoot.length && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const pathsAreEqual = (left, right) => normalizeFilesystemPath(left) === normalizeFilesystemPath(right);

const pathIsWithin = (parent, candidate) => {
  const normalizedParent = normalizeFilesystemPath(parent);
  const normalizedCandidate = normalizeFilesystemPath(candidate);
  const parentPrefix = normalizedParent.endsWith(path.sep)
    ? normalizedParent
    : `${normalizedParent}${path.sep}`;
  return normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(parentPrefix);
};

const sameFileIdentity = (left, right) => left.ino === right.ino
  && (process.platform === 'win32' || left.dev === right.dev);

const readExactDescriptorBytes = (descriptor, size, label) => {
  const data = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = readSync(descriptor, data, offset, size - offset, offset);
    invariant(bytesRead > 0, `${label} changed size or became truncated while being read`);
    offset += bytesRead;
  }
  return data;
};

const readCanonicalStandaloneFile = (filePath, label, maximumBytes) => {
  const resolvedPath = path.resolve(filePath);
  invariant(existsSync(resolvedPath), `${label} does not exist: ${resolvedPath}`);
  const pathStat = lstatSync(resolvedPath, { bigint: true });
  invariant(!pathStat.isSymbolicLink() && pathStat.isFile(), `${label} must be a real regular file`);
  const realPath = realpathSync.native(resolvedPath);
  invariant(
    pathsAreEqual(resolvedPath, realPath),
    `${label} or one of its ancestors resolves through a symbolic link or junction`,
  );
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(realPath, fsConstants.O_RDONLY | noFollow);
  try {
    const openedStat = fstatSync(descriptor, { bigint: true });
    invariant(openedStat.isFile(), `${label} descriptor is not a regular file`);
    invariant(sameFileIdentity(pathStat, openedStat), `${label} changed while it was opened`);
    invariant(
      openedStat.size >= 0n && openedStat.size <= BigInt(Number.MAX_SAFE_INTEGER),
      `${label} size is outside the safe integer range`,
    );
    const size = Number(openedStat.size);
    invariant(size > 0, `${label} is empty`);
    invariant(size <= maximumBytes, `${label} exceeds the ${maximumBytes}-byte size limit`);
    const data = readExactDescriptorBytes(descriptor, size, label);
    const finalStat = fstatSync(descriptor, { bigint: true });
    invariant(sameFileIdentity(openedStat, finalStat), `${label} identity changed while being read`);
    invariant(
      finalStat.size === openedStat.size
        && finalStat.mtimeNs === openedStat.mtimeNs
        && finalStat.ctimeNs === openedStat.ctimeNs,
      `${label} metadata changed while being read`,
    );
    return { path: realPath, data, stat: openedStat };
  } finally {
    closeSync(descriptor);
  }
};

const resolveCanonicalRepositoryRoot = (repoRoot) => {
  const resolvedRoot = path.resolve(repoRoot);
  invariant(existsSync(resolvedRoot), `Repository root does not exist: ${resolvedRoot}`);
  const rootStat = lstatSync(resolvedRoot);
  invariant(!rootStat.isSymbolicLink() && rootStat.isDirectory(), 'Repository root must be a real directory');
  const realRoot = realpathSync.native(resolvedRoot);
  invariant(
    pathsAreEqual(resolvedRoot, realRoot),
    'Repository root or one of its ancestors resolves through a symbolic link or junction',
  );
  return realRoot;
};

const inspectContainedInput = (repoRoot, relativePath, expectedType) => {
  assertSafeRelativePath(relativePath, 'release input path');
  const absolutePath = path.resolve(repoRoot, ...relativePath.split('/'));
  invariant(pathIsWithin(repoRoot, absolutePath), `Release input escapes the repository root: ${relativePath}`);
  invariant(existsSync(absolutePath), `Required release input is missing: ${relativePath}`);
  const stat = lstatSync(absolutePath);
  invariant(!stat.isSymbolicLink(), `Symbolic links cannot be shipped: ${relativePath}`);
  invariant(
    expectedType === 'directory' ? stat.isDirectory() : stat.isFile(),
    expectedType === 'directory'
      ? `Release input is not a directory: ${relativePath}`
      : `Release input is not a regular file: ${relativePath}`,
  );
  const realPath = realpathSync.native(absolutePath);
  invariant(pathIsWithin(repoRoot, realPath), `Release input resolves outside the repository root: ${relativePath}`);
  invariant(
    pathsAreEqual(absolutePath, realPath),
    `Release input or one of its ancestors resolves through a symbolic link or junction: ${relativePath}`,
  );
  return { absolutePath: realPath, stat };
};

const assertRequiredPayloadPaths = (paths) => {
  for (const requiredPath of REQUIRED_PAYLOAD_FILES) {
    invariant(paths.has(requiredPath), `Required release payload file is missing: ${requiredPath}`);
  }
};

const walkRegularFiles = (repoRoot, sourceRelative, archiveRelative) => {
  const { absolutePath: sourceRoot } = inspectContainedInput(repoRoot, sourceRelative, 'directory');
  const files = [];
  const visit = (absoluteDirectory, archiveDirectory) => {
    const entries = readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const relativePath = `${archiveDirectory}/${entry.name}`;
      const sourcePath = `${sourceRelative}/${path.relative(sourceRoot, absolutePath).split(path.sep).join('/')}`;
      const { absolutePath: realPath, stat } = inspectContainedInput(repoRoot, sourcePath, entry.isDirectory() ? 'directory' : 'file');
      if (stat.isDirectory()) {
        visit(realPath, relativePath);
      } else {
        invariant(stat.isFile(), `Only regular files can be shipped: ${relativePath}`);
        assertPayloadPathAllowed(relativePath);
        files.push({ path: relativePath, absolutePath: realPath, size: stat.size });
      }
    }
  };
  visit(sourceRoot, archiveRelative);
  invariant(files.length > 0, `Required release directory is empty: ${sourceRelative}`);
  return files;
};

export const validatePayloadResourceSummary = (files, limits = RELEASE_LIMITS) => {
  invariant(Array.isArray(files), 'Payload resource summary must be an array');
  invariant(files.length <= limits.maxPayloadFileCount, `Release payload exceeds the ${limits.maxPayloadFileCount}-file limit`);
  let totalBytes = 0;
  for (const file of files) {
    invariant(file && typeof file.path === 'string', 'Payload resource entry path is invalid');
    assertPayloadPathAllowed(file.path);
    invariant(Number.isSafeInteger(file.size) && file.size >= 0, `Payload resource size is invalid: ${file.path}`);
    invariant(
      file.size <= limits.maxPayloadFileBytes,
      `Release payload file exceeds the ${limits.maxPayloadFileBytes}-byte limit: ${file.path}`,
    );
    totalBytes += file.size;
    invariant(Number.isSafeInteger(totalBytes), 'Release payload total size exceeds JavaScript safe integer limits');
    invariant(
      totalBytes <= limits.maxPayloadTotalBytes,
      `Release payload exceeds the ${limits.maxPayloadTotalBytes}-byte total limit`,
    );
  }
  return { fileCount: files.length, totalBytes };
};

export const validateReleaseEnvelopeResourceSummary = (summary, limits = RELEASE_LIMITS) => {
  invariant(summary && typeof summary === 'object' && !Array.isArray(summary), 'Release envelope summary must be an object');
  const checks = [
    ['manifestBytes', limits.maxManifestBytes, 'Release manifest', 'byte'],
    ['uncompressedArchiveBytes', limits.maxUncompressedArchiveBytes, 'Uncompressed release archive', 'byte'],
    ['compressedArchiveBytes', limits.maxCompressedArchiveBytes, 'Compressed release archive', 'byte'],
    ['archiveEntryCount', limits.maxArchiveEntries, 'Release archive entry count', 'entry'],
  ];
  for (const [field, maximum, label, unit] of checks) {
    if (summary[field] === undefined) continue;
    invariant(Number.isSafeInteger(summary[field]) && summary[field] >= 0, `${label} is invalid`);
    invariant(summary[field] <= maximum, `${label} exceeds the ${maximum}-${unit} limit`);
  }
  return summary;
};

const scanPayload = (repoRoot, selectedTrees = RUNTIME_TREES, includeFixedFiles = true) => {
  const resolvedRoot = resolveCanonicalRepositoryRoot(repoRoot);
  const files = [];
  for (const [sourceRelative, archiveRelative] of selectedTrees) {
    files.push(...walkRegularFiles(resolvedRoot, sourceRelative, archiveRelative));
  }
  if (includeFixedFiles) {
    for (const relativePath of FIXED_RUNTIME_FILES) {
      assertPayloadPathAllowed(relativePath);
      const { absolutePath, stat } = inspectContainedInput(resolvedRoot, relativePath, 'file');
      files.push({ path: relativePath, absolutePath, size: stat.size });
    }
  }

  files.sort((left, right) => compareText(left.path, right.path));
  const seen = new Set();
  for (const file of files) {
    invariant(!seen.has(file.path), `Duplicate release payload path: ${file.path}`);
    seen.add(file.path);
  }
  validatePayloadResourceSummary(files);
  return { repoRoot: resolvedRoot, files, paths: seen };
};

const readScannedPayloadFile = (repoRoot, descriptor) => {
  const { absolutePath, stat } = inspectContainedInput(repoRoot, descriptor.path, 'file');
  invariant(pathsAreEqual(absolutePath, descriptor.absolutePath), `Release input changed while packaging: ${descriptor.path}`);
  invariant(stat.size === descriptor.size, `Release input size changed while packaging: ${descriptor.path}`);
  const data = readFileSync(absolutePath);
  invariant(data.length === descriptor.size, `Release input changed while packaging: ${descriptor.path}`);
  return { path: descriptor.path, data };
};

export const collectPayload = (repoRoot) => {
  const scanned = scanPayload(repoRoot);
  assertRequiredPayloadPaths(scanned.paths);
  return scanned.files.map((descriptor) => readScannedPayloadFile(scanned.repoRoot, descriptor));
};

export const preflightPayloadTree = ({ repoRoot, relativePath }) => {
  const normalizedPath = assertSafeRelativePath(relativePath, 'preflight payload root');
  const tree = RUNTIME_TREES.find(([sourceRelative]) => sourceRelative === normalizedPath);
  invariant(tree, `Unsupported preflight payload root: ${normalizedPath}`);
  const scanned = scanPayload(repoRoot, [tree], false);
  const requiredForTree = RUNTIME_ENTRYPOINT_FILES.filter((requiredPath) => requiredPath.startsWith(`${normalizedPath}/`));
  for (const requiredPath of requiredForTree) {
    invariant(scanned.paths.has(requiredPath), `Required release payload file is missing: ${requiredPath}`);
  }
  const resources = validatePayloadResourceSummary(scanned.files);
  return { path: normalizedPath, ...resources };
};

const parseJson = (data, label) => {
  let value;
  try {
    value = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${error.message}`);
  }
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
};

const readJson = (filePath, label) => parseJson(readFileSync(filePath), label);

const validateStringKeys = (object, expectedKeys, label) => {
  invariant(object && typeof object === 'object' && !Array.isArray(object), `${label} must be an object`);
  const actualKeys = Object.keys(object).sort(compareText);
  const sortedExpected = [...expectedKeys].sort(compareText);
  invariant(JSON.stringify(actualKeys) === JSON.stringify(sortedExpected), `${label} has unexpected or missing fields`);
};

const validateUiReleaseIdentity = ({ payloadByPath, releaseId, sourceSha }) => {
  const metadataPath = 'ui/build/release-metadata.json';
  const metadataData = payloadByPath.get(metadataPath);
  invariant(metadataData, `${metadataPath} is required`);
  const metadata = parseJson(metadataData, metadataPath);
  validateStringKeys(metadata, ['schemaVersion', 'releaseId', 'gitSha'], metadataPath);
  invariant(metadata.schemaVersion === 1, `${metadataPath} schemaVersion must be 1`);
  invariant(typeof metadata.releaseId === 'string', `${metadataPath} releaseId must be a string`);
  invariant(metadata.releaseId === releaseId, `${metadataPath} releaseId does not match the release manifest`);
  invariant(
    typeof metadata.gitSha === 'string' && SOURCE_SHA_PATTERN.test(metadata.gitSha),
    `${metadataPath} gitSha must be a full lowercase Git SHA`,
  );
  invariant(metadata.gitSha === sourceSha, `${metadataPath} gitSha does not match the release manifest`);

  const releaseLiteral = Buffer.from(JSON.stringify(releaseId), 'utf8');
  const mainAsset = resolveMainUiAsset(payloadByPath);
  const mainBundle = payloadByPath.get(mainAsset);
  const serviceWorker = payloadByPath.get('ui/build/service-worker.js');
  invariant(mainBundle?.includes(releaseLiteral), `${mainAsset} does not embed releaseId as an exact JavaScript string literal`);
  invariant(
    serviceWorker?.includes(releaseLiteral),
    'ui/build/service-worker.js does not embed releaseId as an exact JavaScript string literal',
  );
  return { metadata, mainAsset };
};

export const readPinnedToolchain = (repoRoot) => {
  const resolvedRoot = resolveCanonicalRepositoryRoot(repoRoot);
  const nodeVersions = new Set();
  const npmVersions = new Set();
  for (const relativePath of PACKAGE_PATHS) {
    const { absolutePath } = inspectContainedInput(resolvedRoot, relativePath, 'file');
    const manifest = readJson(absolutePath, relativePath);
    const nodeVersion = String(manifest.engines?.node || '').trim();
    const npmEngineVersion = String(manifest.engines?.npm || '').trim();
    const packageManagerMatch = /^npm@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(String(manifest.packageManager || '').trim());
    invariant(/^\d+\.\d+\.\d+$/.test(nodeVersion), `${relativePath} must pin an exact Node.js version`);
    invariant(/^\d+\.\d+\.\d+$/.test(npmEngineVersion), `${relativePath} must pin an exact npm version`);
    invariant(packageManagerMatch, `${relativePath} must pin packageManager to npm@<exact-version>`);
    invariant(
      packageManagerMatch[1] === npmEngineVersion,
      `${relativePath} has inconsistent npm engine and packageManager versions`,
    );
    nodeVersions.add(nodeVersion);
    npmVersions.add(npmEngineVersion);
  }
  invariant(nodeVersions.size === 1, 'All packages must use the same pinned Node.js version');
  invariant(npmVersions.size === 1, 'All packages must use the same pinned npm version');

  const { absolutePath: nvmrcPath } = inspectContainedInput(resolvedRoot, '.nvmrc', 'file');
  const nvmrc = readFileSync(nvmrcPath, 'utf8').trim().replace(/^v/, '');
  const [node] = nodeVersions;
  const [npm] = npmVersions;
  invariant(nvmrc === node, '.nvmrc must match the package Node.js engine exactly');
  return { node, npm };
};

const normalizeWorkflowPath = (value) => {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  assertSafeRelativePath(normalized, 'workflow path');
  return normalized;
};

const requireText = (value, label) => {
  const result = String(value ?? '').trim();
  invariant(result.length > 0, `${label} is required`);
  return result;
};

const requirePositiveIntegerText = (value, label) => {
  const result = requireText(value, label);
  invariant(POSITIVE_INTEGER_PATTERN.test(result), `${label} must be a positive integer`);
  return result;
};

const normalizeBuiltAt = (value) => {
  const builtAtUtc = requireText(value, 'builtAtUtc');
  const parsed = new Date(builtAtUtc);
  invariant(!Number.isNaN(parsed.getTime()), 'builtAtUtc must be a valid UTC timestamp');
  invariant(parsed.toISOString() === builtAtUtc, 'builtAtUtc must be a canonical ISO-8601 UTC timestamp');
  return builtAtUtc;
};

const deriveEligibility = ({ sourceSha, releaseId, workflow }) => {
  const reasons = [];
  if (workflow.repository !== CANONICAL_REPOSITORY) reasons.push('repository_not_canonical');
  if (workflow.workflowPath !== CANONICAL_WORKFLOW_PATH) reasons.push('workflow_not_canonical');
  if (workflow.event !== 'push') reasons.push('event_not_push');
  if (workflow.ref !== CANONICAL_RELEASE_REF) reasons.push('ref_not_master');
  if (workflow.headSha !== sourceSha) reasons.push('head_sha_mismatch');
  if (!POSITIVE_INTEGER_PATTERN.test(workflow.runId)) reasons.push('run_id_missing');
  if (!Number.isSafeInteger(workflow.runAttempt) || workflow.runAttempt < 1) reasons.push('run_attempt_missing');
  if (workflow.artifactName !== releaseId) reasons.push('artifact_name_mismatch');
  return {
    canonicalRepository: CANONICAL_REPOSITORY,
    canonicalWorkflowPath: CANONICAL_WORKFLOW_PATH,
    requiredEvent: 'push',
    requiredRef: CANONICAL_RELEASE_REF,
    candidate: reasons.length === 0,
    reasons,
    externalChecksRequired: [...REQUIRED_EXTERNAL_PRODUCTION_CHECKS],
  };
};

const normalizeProvenance = (input, sourceSha, releaseId) => {
  const workflow = {
    repository: requireText(input.repository, 'workflow repository'),
    canonicalRepository: CANONICAL_REPOSITORY,
    workflowName: requireText(input.workflowName, 'workflow name'),
    workflowPath: normalizeWorkflowPath(input.workflowPath),
    canonicalWorkflowPath: CANONICAL_WORKFLOW_PATH,
    event: requireText(input.event, 'workflow event'),
    ref: requireText(input.ref, 'workflow ref'),
    headSha: requireText(input.headSha ?? sourceSha, 'workflow head SHA').toLowerCase(),
    runId: requirePositiveIntegerText(input.runId, 'workflow run ID'),
    runAttempt: Number(requirePositiveIntegerText(input.runAttempt, 'workflow run attempt')),
    runNumber: input.runNumber == null || String(input.runNumber).trim() === ''
      ? null
      : requirePositiveIntegerText(input.runNumber, 'workflow run number'),
    actor: input.actor == null || String(input.actor).trim() === '' ? null : String(input.actor).trim(),
    artifactName: requireText(input.artifactName ?? releaseId, 'artifact name'),
  };
  invariant(SOURCE_SHA_PATTERN.test(workflow.headSha), 'workflow head SHA must be a full lowercase Git SHA');
  return workflow;
};

const expectedReleaseId = (sourceSha, workflow) =>
  `omnilodge-r${workflow.runId}-a${workflow.runAttempt}-${sourceSha.slice(0, 12)}`;

const resolveMainUiAsset = (payloadByPath) => {
  const assetManifestData = payloadByPath.get('ui/build/asset-manifest.json');
  invariant(assetManifestData, 'ui/build/asset-manifest.json is missing from the release payload');
  const assetManifest = parseJson(assetManifestData, 'ui/build/asset-manifest.json');
  const rawMainAsset = String(assetManifest.files?.['main.js'] || '').trim();
  invariant(rawMainAsset.length > 0, 'ui/build/asset-manifest.json must identify files["main.js"]');
  const buildRelative = rawMainAsset.replace(/^\/+/, '');
  assertSafeRelativePath(buildRelative, 'main UI asset path');
  invariant(/^static\/js\/main\.[A-Za-z0-9_-]+\.js$/.test(buildRelative), 'Main UI asset must be a hashed JavaScript file');
  const archivePath = `ui/build/${buildRelative}`;
  invariant(payloadByPath.has(archivePath), `Main UI asset is missing from the release payload: ${archivePath}`);
  return archivePath;
};

export const createReleaseManifest = ({ repoRoot, payload, metadata }) => {
  const resolvedRoot = resolveCanonicalRepositoryRoot(repoRoot);
  const sourceSha = requireText(metadata.sourceSha, 'source SHA').toLowerCase();
  invariant(SOURCE_SHA_PATTERN.test(sourceSha), 'source SHA must be a full lowercase Git SHA');
  const releaseId = requireText(metadata.releaseId, 'release ID');
  invariant(RELEASE_ID_PATTERN.test(releaseId), 'release ID must match omnilodge-r<run>-a<attempt>-<12-char-sha>');
  const builtAtUtc = normalizeBuiltAt(metadata.builtAtUtc);
  const workflow = normalizeProvenance(metadata.workflow || {}, sourceSha, releaseId);
  invariant(releaseId === expectedReleaseId(sourceSha, workflow), 'release ID does not match run ID, attempt, and source SHA');

  const toolchain = readPinnedToolchain(resolvedRoot);
  invariant(Array.isArray(payload) && payload.length > 0, 'Release payload must be a non-empty array');
  for (const file of payload) {
    invariant(file && typeof file.path === 'string', 'Release payload entry path is invalid');
    invariant(Buffer.isBuffer(file.data), `Release payload data must be a Buffer: ${file.path}`);
    assertPayloadPathAllowed(file.path);
  }
  const payloadPaths = payload.map((file) => file.path);
  invariant(new Set(payloadPaths).size === payloadPaths.length, 'Release payload contains duplicate paths');
  invariant(
    JSON.stringify(payloadPaths) === JSON.stringify([...payloadPaths].sort(compareText)),
    'Release payload must be sorted by path',
  );
  assertRequiredPayloadPaths(new Set(payloadPaths));
  const payloadByPath = new Map(payload.map((file) => [file.path, file.data]));
  const files = payload.map((file) => ({
    path: file.path,
    size: file.data.length,
    sha256: sha256(file.data),
  }));
  validatePayloadResourceSummary(files);
  const lockfiles = {};
  for (const lockfilePath of LOCKFILE_PATHS) {
    const { absolutePath: lockfileAbsolutePath } = inspectContainedInput(resolvedRoot, lockfilePath, 'file');
    const lockData = readFileSync(lockfileAbsolutePath);
    lockfiles[lockfilePath] = sha256(lockData);
    if (payloadByPath.has(lockfilePath)) {
      invariant(payloadByPath.get(lockfilePath).equals(lockData), `${lockfilePath} changed while the release was being packaged`);
    }
  }

  const { mainAsset: mainUiAsset } = validateUiReleaseIdentity({
    payloadByPath,
    releaseId,
    sourceSha,
  });
  const productionEligibility = deriveEligibility({ sourceSha, releaseId, workflow });
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    releaseId,
    sourceSha,
    builtAtUtc,
    toolchain,
    lockfiles,
    mainUiAsset,
    fileCount: files.length,
    files,
    workflow,
    productionEligibility,
  };
};

export const serializeReleaseManifest = (manifest) =>
  Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const writeString = (buffer, offset, length, value) => {
  const encoded = Buffer.from(value, 'utf8');
  invariant(encoded.length <= length, `Tar field is too long: ${value}`);
  encoded.copy(buffer, offset);
};

const octal = (value, length) => {
  const encoded = Math.trunc(value).toString(8);
  invariant(encoded.length <= length - 1, `Tar numeric field is too large: ${value}`);
  return `${encoded.padStart(length - 1, '0')}\0`;
};

const splitTarPath = (entryPath) => {
  const encoded = Buffer.byteLength(entryPath, 'utf8');
  if (encoded <= 100) return { name: entryPath, prefix: '' };
  const slashIndexes = [];
  for (let index = 0; index < entryPath.length; index += 1) {
    if (entryPath[index] === '/') slashIndexes.push(index);
  }
  for (let index = slashIndexes.length - 1; index >= 0; index -= 1) {
    const separator = slashIndexes[index];
    const prefix = entryPath.slice(0, separator);
    const name = entryPath.slice(separator + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Archive path exceeds the ustar limit: ${entryPath}`);
};

const createTarHeader = ({ entryPath, size, type }) => {
  const safePath = assertSafeRelativePath(entryPath, 'archive entry path');
  const { name, prefix } = splitTarPath(safePath);
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, name);
  writeString(header, 100, 8, octal(type === 'directory' ? 0o755 : 0o644, 8));
  writeString(header, 108, 8, octal(0, 8));
  writeString(header, 116, 8, octal(0, 8));
  writeString(header, 124, 12, octal(size, 12));
  writeString(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = type === 'directory' ? 0x35 : 0x30;
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
};

const padToTarBlock = (buffer) => {
  const padding = (512 - (buffer.length % 512)) % 512;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, 0)]);
};

const directoriesForFiles = (rootName, filePaths) => {
  const directories = new Set([rootName]);
  const maximumDirectoryCount = RELEASE_LIMITS.maxArchiveEntries - filePaths.length;
  invariant(maximumDirectoryCount >= 1, 'Release archive does not have capacity for its root directory');
  for (const filePath of filePaths) {
    const segments = `${rootName}/${filePath}`.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
      invariant(
        directories.size <= maximumDirectoryCount,
        `Release archive entry count exceeds the ${RELEASE_LIMITS.maxArchiveEntries}-entry limit`,
      );
    }
  }
  return [...directories].sort(compareText);
};

export const createTarGzipBuffer = ({ rootName, files }) => {
  assertSafeRelativePath(rootName, 'archive root');
  invariant(!rootName.includes('/'), 'archive root must be one directory name');
  const sortedFiles = [...files].sort((left, right) => compareText(left.path, right.path));
  const seen = new Set();
  for (const file of sortedFiles) {
    assertSafeRelativePath(file.path, 'archive file path');
    splitTarPath(`${rootName}/${file.path}`);
    invariant(!seen.has(file.path), `Duplicate archive file path: ${file.path}`);
    invariant(Buffer.isBuffer(file.data), `Archive file data must be a Buffer: ${file.path}`);
    seen.add(file.path);
  }

  const manifestFiles = sortedFiles.filter((file) => file.path === 'release-manifest.json');
  invariant(manifestFiles.length === 1, 'Canonical release input must contain exactly one release manifest');
  validateReleaseEnvelopeResourceSummary({ manifestBytes: manifestFiles[0].data.length });
  validatePayloadResourceSummary(
    sortedFiles
      .filter((file) => file.path !== 'release-manifest.json')
      .map((file) => ({ path: file.path, size: file.data.length })),
  );

  const chunks = [];
  const directories = directoriesForFiles(rootName, sortedFiles.map((file) => file.path));
  validateReleaseEnvelopeResourceSummary({ archiveEntryCount: directories.length + sortedFiles.length });
  for (const directory of directories) {
    chunks.push(createTarHeader({ entryPath: directory, size: 0, type: 'directory' }));
  }
  for (const file of sortedFiles) {
    const entryPath = `${rootName}/${file.path}`;
    chunks.push(createTarHeader({ entryPath, size: file.data.length, type: 'file' }));
    chunks.push(padToTarBlock(file.data));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  validateReleaseEnvelopeResourceSummary({ uncompressedArchiveBytes: tar.length });
  const compressed = gzipSync(tar, { level: 9, mtime: 0 });
  validateReleaseEnvelopeResourceSummary({ compressedArchiveBytes: compressed.length });
  // RFC 1952's OS byte is informational. Neutralizing it removes one source
  // of host variance; authoritative reproducibility is asserted on Ubuntu.
  if (compressed.length >= 10) compressed[9] = 255;
  return compressed;
};

const findNearestExistingAncestor = (targetPath) => {
  let candidate = targetPath;
  while (!existsSync(candidate)) {
    const parent = path.dirname(candidate);
    invariant(parent !== candidate, `Cannot resolve an existing ancestor for output path: ${targetPath}`);
    candidate = parent;
  }
  return candidate;
};

const prepareOutputDirectory = (repoRoot, outputDir) => {
  const resolvedOutput = path.resolve(outputDir);
  const includedRoots = RUNTIME_TREES.map(([sourceRelative]) =>
    inspectContainedInput(repoRoot, sourceRelative, 'directory').absolutePath);
  for (const includedRoot of includedRoots) {
    invariant(
      !pathIsWithin(includedRoot, resolvedOutput) && !pathIsWithin(resolvedOutput, includedRoot),
      'Release output directory cannot overlap an included payload tree',
    );
  }

  const existingAncestor = findNearestExistingAncestor(resolvedOutput);
  const ancestorStat = lstatSync(existingAncestor);
  invariant(!ancestorStat.isSymbolicLink() && ancestorStat.isDirectory(), 'Release output ancestor must be a real directory');
  const realAncestor = realpathSync.native(existingAncestor);
  invariant(
    pathsAreEqual(existingAncestor, realAncestor),
    'Release output directory or one of its ancestors resolves through a symbolic link or junction',
  );

  mkdirSync(resolvedOutput, { recursive: true, mode: 0o700 });
  const outputStat = lstatSync(resolvedOutput);
  invariant(!outputStat.isSymbolicLink() && outputStat.isDirectory(), 'Release output must be a real directory');
  const realOutput = realpathSync.native(resolvedOutput);
  invariant(
    pathsAreEqual(resolvedOutput, realOutput),
    'Release output directory or one of its ancestors resolves through a symbolic link or junction',
  );
  for (const includedRoot of includedRoots) {
    invariant(
      !pathIsWithin(includedRoot, realOutput) && !pathIsWithin(realOutput, includedRoot),
      'Release output directory cannot overlap an included payload tree',
    );
  }
  return realOutput;
};

const writeTemporaryOutput = (filePath, data) => {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    throw error;
  }
  closeSync(descriptor);
  return temporaryPath;
};

const linkOutputNoReplace = (temporaryPath, finalPath) => {
  try {
    linkSync(temporaryPath, finalPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite immutable release output: ${finalPath}`);
    }
    throw error;
  }
};

const publishImmutableReleaseOutputs = ({ archivePath, archive, checksumPath, checksumData }) => {
  const archiveTemporaryPath = writeTemporaryOutput(archivePath, archive);
  let checksumTemporaryPath;
  let checksumPublished = false;
  let archivePublished = false;
  try {
    checksumTemporaryPath = writeTemporaryOutput(checksumPath, checksumData);
    // The archive is the publication marker: readers can never observe the
    // final archive name before its detached checksum has been published.
    linkOutputNoReplace(checksumTemporaryPath, checksumPath);
    checksumPublished = true;
    linkOutputNoReplace(archiveTemporaryPath, archivePath);
    archivePublished = true;
  } catch (error) {
    if (checksumPublished && !archivePublished) {
      unlinkSync(checksumPath);
    }
    throw error;
  } finally {
    if (existsSync(archiveTemporaryPath)) rmSync(archiveTemporaryPath, { force: true });
    if (checksumTemporaryPath && existsSync(checksumTemporaryPath)) rmSync(checksumTemporaryPath, { force: true });
  }
};

export const packageRelease = ({ repoRoot, outputDir, metadata }) => {
  const resolvedRoot = resolveCanonicalRepositoryRoot(repoRoot);
  const resolvedOutput = prepareOutputDirectory(resolvedRoot, outputDir);
  const payload = collectPayload(resolvedRoot);
  const manifest = createReleaseManifest({ repoRoot: resolvedRoot, payload, metadata });
  const manifestData = serializeReleaseManifest(manifest);
  validateReleaseEnvelopeResourceSummary({ manifestBytes: manifestData.length });
  const archive = createTarGzipBuffer({
    rootName: manifest.releaseId,
    files: [
      ...payload,
      { path: 'release-manifest.json', data: manifestData },
    ],
  });
  const archiveName = `${manifest.releaseId}.tar.gz`;
  const checksumName = `${archiveName}.sha256`;
  const archivePath = path.join(resolvedOutput, archiveName);
  const checksumPath = path.join(resolvedOutput, checksumName);
  const archiveSha256 = sha256(archive);
  const checksumData = `${archiveSha256}  ${archiveName}\n`;
  publishImmutableReleaseOutputs({ archivePath, archive, checksumPath, checksumData });
  return { manifest, archivePath, checksumPath, archiveSha256 };
};

const readNullTerminated = (buffer, offset, length) => {
  const field = buffer.subarray(offset, offset + length);
  const nullIndex = field.indexOf(0);
  return field.subarray(0, nullIndex === -1 ? field.length : nullIndex).toString('utf8');
};

const parseTarOctal = (buffer, offset, length, label) => {
  const raw = readNullTerminated(buffer, offset, length).trim();
  invariant(raw === '' || /^[0-7]+$/.test(raw), `Invalid tar ${label}`);
  const value = raw === '' ? 0 : Number.parseInt(raw, 8);
  invariant(Number.isSafeInteger(value) && value >= 0, `Invalid tar ${label}`);
  return value;
};

const parseTar = (archive) => {
  validateReleaseEnvelopeResourceSummary({ compressedArchiveBytes: archive.length });
  invariant(
    archive.length >= 10
      && archive[0] === 0x1f
      && archive[1] === 0x8b
      && archive[2] === 0x08
      && archive[3] === 0
      && archive.readUInt32LE(4) === 0
      && archive[9] === 255,
    'Release archive does not use the canonical gzip header',
  );
  let tar;
  try {
    tar = gunzipSync(archive, { maxOutputLength: RELEASE_LIMITS.maxUncompressedArchiveBytes });
  } catch (error) {
    throw new Error(`Release archive is not valid gzip data: ${error.message}`);
  }
  validateReleaseEnvelopeResourceSummary({ uncompressedArchiveBytes: tar.length });

  const entries = [];
  const seen = new Set();
  let offset = 0;
  let endFound = false;
  let payloadFileCount = 0;
  let payloadTotalBytes = 0;
  let manifestEntryCount = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      invariant(
        tar.subarray(offset).every((byte) => byte === 0),
        'Release archive contains data after the tar end marker',
      );
      invariant(tar.length - offset === 1024, 'Release archive must end with exactly two empty tar blocks');
      endFound = true;
      break;
    }
    validateReleaseEnvelopeResourceSummary({ archiveEntryCount: entries.length + 1 });
    const storedChecksum = parseTarOctal(header, 148, 8, 'checksum');
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const calculatedChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    invariant(storedChecksum === calculatedChecksum, 'Release archive contains a tar header with an invalid checksum');
    invariant(readNullTerminated(header, 257, 6) === 'ustar', 'Release archive entry is not canonical ustar');
    invariant(readNullTerminated(header, 263, 2) === '00', 'Release archive entry has an unsupported tar version');
    invariant(readNullTerminated(header, 157, 100) === '', 'Release archive entries cannot contain link targets');
    invariant(readNullTerminated(header, 265, 32) === '', 'Release archive entries cannot contain user names');
    invariant(readNullTerminated(header, 297, 32) === '', 'Release archive entries cannot contain group names');

    const name = readNullTerminated(header, 0, 100);
    const prefix = readNullTerminated(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const typeByte = header[156];
    const type = typeByte === 0x35 ? 'directory' : typeByte === 0x30 ? 'file' : 'unsupported';
    invariant(type !== 'unsupported', `Release archive contains a link or unsupported tar entry: ${entryPath}`);
    const safePath = assertSafeRelativePath(entryPath, 'archive entry path');
    invariant(!seen.has(safePath), `Release archive contains a duplicate path: ${safePath}`);
    seen.add(safePath);

    const mode = parseTarOctal(header, 100, 8, 'mode');
    const uid = parseTarOctal(header, 108, 8, 'uid');
    const gid = parseTarOctal(header, 116, 8, 'gid');
    const size = parseTarOctal(header, 124, 12, 'size');
    const mtime = parseTarOctal(header, 136, 12, 'mtime');
    invariant(uid === 0 && gid === 0, `Release archive has an unexpected owner: ${safePath}`);
    invariant(mtime === 0, `Release archive has a non-deterministic timestamp: ${safePath}`);
    invariant(mode === (type === 'directory' ? 0o755 : 0o644), `Release archive has an unexpected mode: ${safePath}`);
    invariant(type !== 'directory' || size === 0, `Release archive directory has content: ${safePath}`);

    if (type === 'file') {
      if (safePath.endsWith('/release-manifest.json')) {
        manifestEntryCount += 1;
        invariant(manifestEntryCount <= 1, 'Release archive contains more than one release manifest');
        validateReleaseEnvelopeResourceSummary({ manifestBytes: size });
      } else {
        payloadFileCount += 1;
        payloadTotalBytes += size;
        invariant(
          payloadFileCount <= RELEASE_LIMITS.maxPayloadFileCount,
          `Release payload exceeds the ${RELEASE_LIMITS.maxPayloadFileCount}-file limit`,
        );
        invariant(
          size <= RELEASE_LIMITS.maxPayloadFileBytes,
          `Release payload file exceeds the ${RELEASE_LIMITS.maxPayloadFileBytes}-byte limit: ${safePath}`,
        );
        invariant(
          Number.isSafeInteger(payloadTotalBytes) && payloadTotalBytes <= RELEASE_LIMITS.maxPayloadTotalBytes,
          `Release payload exceeds the ${RELEASE_LIMITS.maxPayloadTotalBytes}-byte total limit`,
        );
      }
    }

    const dataOffset = offset + 512;
    const nextOffset = dataOffset + Math.ceil(size / 512) * 512;
    invariant(nextOffset <= tar.length, `Release archive entry is truncated: ${safePath}`);
    const padding = tar.subarray(dataOffset + size, nextOffset);
    invariant(padding.every((byte) => byte === 0), `Release archive entry has non-zero padding: ${safePath}`);
    entries.push({ path: safePath, type, data: Buffer.from(tar.subarray(dataOffset, dataOffset + size)) });
    offset = nextOffset;
  }
  invariant(endFound, 'Release archive is missing the tar end marker');
  return entries;
};

const validateManifestShape = (manifest) => {
  validateStringKeys(manifest, [
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
  ], 'release manifest');
  invariant(manifest.schemaVersion === RELEASE_SCHEMA_VERSION, `Unsupported release manifest schema: ${manifest.schemaVersion}`);
  invariant(RELEASE_ID_PATTERN.test(manifest.releaseId), 'Manifest release ID is invalid');
  invariant(SOURCE_SHA_PATTERN.test(manifest.sourceSha), 'Manifest source SHA is invalid');
  normalizeBuiltAt(manifest.builtAtUtc);
  validateStringKeys(manifest.toolchain, ['node', 'npm'], 'manifest toolchain');
  invariant(/^\d+\.\d+\.\d+$/.test(manifest.toolchain.node), 'Manifest Node.js version is invalid');
  invariant(/^\d+\.\d+\.\d+$/.test(manifest.toolchain.npm), 'Manifest npm version is invalid');

  validateStringKeys(manifest.lockfiles, LOCKFILE_PATHS, 'manifest lockfiles');
  for (const lockHash of Object.values(manifest.lockfiles)) {
    invariant(SHA256_PATTERN.test(lockHash), 'Manifest lockfile hash is invalid');
  }
  assertSafeRelativePath(manifest.mainUiAsset, 'manifest main UI asset');
  invariant(/^ui\/build\/static\/js\/main\.[A-Za-z0-9_-]+\.js$/.test(manifest.mainUiAsset), 'Manifest main UI asset is invalid');
  invariant(Number.isSafeInteger(manifest.fileCount) && manifest.fileCount >= 1, 'Manifest file count is invalid');
  invariant(Array.isArray(manifest.files) && manifest.files.length === manifest.fileCount, 'Manifest file count does not match its file list');

  const filePaths = [];
  for (const file of manifest.files) {
    validateStringKeys(file, ['path', 'size', 'sha256'], 'manifest file entry');
    assertPayloadPathAllowed(file.path);
    splitTarPath(`${manifest.releaseId}/${file.path}`);
    invariant(Number.isSafeInteger(file.size) && file.size >= 0, `Manifest file size is invalid: ${file.path}`);
    invariant(SHA256_PATTERN.test(file.sha256), `Manifest file hash is invalid: ${file.path}`);
    filePaths.push(file.path);
  }
  invariant(
    JSON.stringify(filePaths) === JSON.stringify([...filePaths].sort(compareText)),
    'Manifest files must be sorted by path',
  );
  invariant(new Set(filePaths).size === filePaths.length, 'Manifest contains duplicate file paths');
  assertRequiredPayloadPaths(new Set(filePaths));
  validatePayloadResourceSummary(manifest.files);

  validateStringKeys(manifest.workflow, [
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
  ], 'manifest workflow provenance');
  const normalizedWorkflow = normalizeProvenance(manifest.workflow, manifest.sourceSha, manifest.releaseId);
  invariant(JSON.stringify(normalizedWorkflow) === JSON.stringify(manifest.workflow), 'Manifest workflow provenance is not canonical');
  invariant(
    manifest.releaseId === expectedReleaseId(manifest.sourceSha, manifest.workflow),
    'Manifest release ID does not match its workflow provenance',
  );

  validateStringKeys(
    manifest.productionEligibility,
    [
      'canonicalRepository',
      'canonicalWorkflowPath',
      'requiredEvent',
      'requiredRef',
      'candidate',
      'reasons',
      'externalChecksRequired',
    ],
    'manifest production eligibility',
  );
  const expectedEligibility = deriveEligibility({
    sourceSha: manifest.sourceSha,
    releaseId: manifest.releaseId,
    workflow: manifest.workflow,
  });
  invariant(
    JSON.stringify(manifest.productionEligibility) === JSON.stringify(expectedEligibility),
    'Manifest production eligibility does not match its provenance',
  );
};

const readDetachedChecksum = (checksumPath, archivePath) => {
  const { data: checksumData } = readCanonicalStandaloneFile(
    checksumPath,
    'Detached checksum',
    1024,
  );
  const checksumText = checksumData.toString('utf8');
  const match = /^([0-9a-f]{64}) {2}([^\r\n]+)\r?\n?$/.exec(checksumText);
  invariant(match, 'Detached checksum file has an invalid format');
  invariant(match[2] === path.basename(archivePath), 'Detached checksum names a different archive');
  return match[1];
};

const expectedDirectories = (releaseId, payloadPaths) =>
  new Set(directoriesForFiles(releaseId, [...payloadPaths, 'release-manifest.json']));

const verifyPayload = (manifest, entries) => {
  const root = manifest.releaseId;
  const rootPrefix = `${root}/`;
  const directories = new Set();
  const archiveFiles = new Map();
  for (const entry of entries) {
    invariant(entry.path === root || entry.path.startsWith(rootPrefix), `Release archive contains content outside ${root}`);
    if (entry.type === 'directory') {
      directories.add(entry.path);
    } else {
      const relativePath = entry.path.slice(rootPrefix.length);
      invariant(relativePath.length > 0, 'Release archive contains a file at its root directory path');
      archiveFiles.set(relativePath, entry.data);
    }
  }
  invariant(directories.has(root), 'Release archive is missing its root directory');

  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const expectedFilePaths = new Set([...manifestPaths, 'release-manifest.json']);
  invariant(archiveFiles.size === expectedFilePaths.size, 'Release archive file count does not match the manifest');
  for (const archivePath of archiveFiles.keys()) {
    invariant(expectedFilePaths.has(archivePath), `Release archive contains an unexpected file: ${archivePath}`);
  }
  const requiredDirectories = expectedDirectories(root, manifestPaths);
  invariant(directories.size === requiredDirectories.size, 'Release archive contains unexpected or missing directories');
  for (const directory of directories) {
    invariant(requiredDirectories.has(directory), `Release archive contains an unexpected directory: ${directory}`);
  }
  const expectedEntryOrder = [
    ...[...requiredDirectories].sort(compareText).map((entryPath) => `${entryPath}:directory`),
    ...[...expectedFilePaths].sort(compareText).map((entryPath) => `${root}/${entryPath}:file`),
  ];
  const actualEntryOrder = entries.map((entry) => `${entry.path}:${entry.type}`);
  invariant(
    JSON.stringify(actualEntryOrder) === JSON.stringify(expectedEntryOrder),
    'Release archive entries are not in canonical order',
  );

  for (const file of manifest.files) {
    const data = archiveFiles.get(file.path);
    invariant(data, `Release archive is missing a manifest file: ${file.path}`);
    invariant(data.length === file.size, `Release payload size mismatch: ${file.path}`);
    invariant(sha256(data) === file.sha256, `Release payload hash mismatch: ${file.path}`);
  }
  for (const lockfilePath of LOCKFILE_PATHS) {
    const data = archiveFiles.get(lockfilePath);
    // The browser dependencies are build-time-only, so ui/package-lock.json is
    // intentionally recorded in the manifest but not shipped to production.
    if (lockfilePath === 'ui/package-lock.json') continue;
    invariant(data, `Release archive is missing lockfile: ${lockfilePath}`);
    invariant(sha256(data) === manifest.lockfiles[lockfilePath], `Release lockfile hash mismatch: ${lockfilePath}`);
  }
  invariant(archiveFiles.has(manifest.mainUiAsset), 'Release archive is missing its main UI asset');

  const uiReleaseIdentity = validateUiReleaseIdentity({
    payloadByPath: archiveFiles,
    releaseId: manifest.releaseId,
    sourceSha: manifest.sourceSha,
  });
  invariant(
    uiReleaseIdentity.mainAsset === manifest.mainUiAsset,
    'UI release identity main asset does not match the release manifest',
  );

  const assetManifest = parseJson(
    archiveFiles.get('ui/build/asset-manifest.json'),
    'archived ui/build/asset-manifest.json',
  );
  const archivedMainAsset = `ui/build/${String(assetManifest.files?.['main.js'] || '').replace(/^\/+/, '')}`;
  invariant(archivedMainAsset === manifest.mainUiAsset, 'Archived UI asset manifest does not match the release manifest');

  for (const packageName of ['be', 'ui-server']) {
    const packagePath = `${packageName}/package.json`;
    const packageManifest = parseJson(archiveFiles.get(packagePath), `archived ${packagePath}`);
    invariant(packageManifest.engines?.node === manifest.toolchain.node, `${packagePath} Node.js version does not match the release manifest`);
    invariant(packageManifest.engines?.npm === manifest.toolchain.npm, `${packagePath} npm version does not match the release manifest`);
    invariant(packageManifest.packageManager === `npm@${manifest.toolchain.npm}`, `${packagePath} packageManager does not match the release manifest`);
  }
  return archiveFiles;
};

const verifyProductionEligibility = (manifest, evidence) => {
  invariant(manifest.productionEligibility.candidate, `Artifact is not production-eligible: ${manifest.productionEligibility.reasons.join(', ')}`);
  invariant(evidence && typeof evidence === 'object', 'Authenticated production provenance evidence is required');
  validateStringKeys(evidence, [
    'workflowConclusion',
    'artifactId',
    'artifactDigest',
    'expectedReleaseId',
    'expectedSourceSha',
    'expectedRepository',
    'expectedWorkflowPath',
    'expectedEvent',
    'expectedRef',
    'expectedRunId',
    'expectedRunAttempt',
    'expectedArtifactName',
  ], 'authenticated production provenance evidence');
  invariant(evidence.workflowConclusion === 'success', 'The originating workflow must have concluded successfully');
  invariant(POSITIVE_INTEGER_PATTERN.test(String(evidence.artifactId || '')), 'An immutable GitHub artifact ID is required');
  invariant(
    ARTIFACT_DIGEST_PATTERN.test(String(evidence.artifactDigest || '')),
    'An authenticated lowercase SHA-256 GitHub artifact digest is required',
  );
  invariant(requireText(evidence.expectedReleaseId, 'expected release ID') === manifest.releaseId, 'Expected release ID does not match the manifest');
  const evidenceSourceSha = requireText(evidence.expectedSourceSha, 'expected source SHA');
  invariant(SOURCE_SHA_PATTERN.test(evidenceSourceSha), 'Expected source SHA must be a full lowercase Git SHA');
  invariant(evidenceSourceSha === manifest.sourceSha, 'Expected source SHA does not match the manifest');
  invariant(requireText(evidence.expectedRepository, 'expected repository') === manifest.workflow.repository, 'Expected repository does not match the manifest');
  invariant(normalizeWorkflowPath(evidence.expectedWorkflowPath) === manifest.workflow.workflowPath, 'Expected workflow path does not match the manifest');
  invariant(requireText(evidence.expectedEvent, 'expected workflow event') === manifest.workflow.event, 'Expected workflow event does not match the manifest');
  invariant(requireText(evidence.expectedRef, 'expected workflow ref') === manifest.workflow.ref, 'Expected workflow ref does not match the manifest');
  invariant(requirePositiveIntegerText(evidence.expectedRunId, 'expected workflow run ID') === manifest.workflow.runId, 'Expected workflow run ID does not match the manifest');
  invariant(
    Number(requirePositiveIntegerText(evidence.expectedRunAttempt, 'expected workflow run attempt')) === manifest.workflow.runAttempt,
    'Expected workflow run attempt does not match the manifest',
  );
  invariant(requireText(evidence.expectedArtifactName, 'expected artifact name') === manifest.workflow.artifactName, 'Expected artifact name does not match the manifest');
};

const verifyReleaseArchiveData = ({
  archivePath,
  checksumPath = `${archivePath}.sha256`,
  requireProductionEligible = false,
  productionEvidence = null,
  expectedArchiveSha256 = null,
}) => {
  const {
    path: canonicalArchivePath,
    data: archive,
    stat: archiveStat,
  } = readCanonicalStandaloneFile(
    archivePath,
    'Release archive',
    RELEASE_LIMITS.maxCompressedArchiveBytes,
  );
  validateReleaseEnvelopeResourceSummary({ compressedArchiveBytes: Number(archiveStat.size) });
  const archiveSha256 = sha256(archive);
  if (expectedArchiveSha256 !== null) {
    invariant(
      typeof expectedArchiveSha256 === 'string'
        && SHA256_PATTERN.test(expectedArchiveSha256),
      'Trusted expected release archive SHA-256 is required as 64 lowercase hexadecimal characters',
    );
    invariant(
      archiveSha256 === expectedArchiveSha256,
      'Release archive SHA-256 does not match the trusted expected archive SHA-256',
    );
  }
  const expectedArchiveHash = readDetachedChecksum(checksumPath, canonicalArchivePath);
  invariant(archiveSha256 === expectedArchiveHash, 'Detached release archive checksum does not match');
  const entries = parseTar(archive);

  const manifestEntries = entries.filter((entry) =>
    entry.type === 'file' && entry.path.endsWith('/release-manifest.json'));
  invariant(manifestEntries.length === 1, 'Release archive must contain exactly one release manifest');
  validateReleaseEnvelopeResourceSummary({ manifestBytes: manifestEntries[0].data.length });
  let manifest;
  try {
    manifest = JSON.parse(manifestEntries[0].data.toString('utf8'));
  } catch (error) {
    throw new Error(`Release manifest is not valid JSON: ${error.message}`);
  }
  invariant(
    manifestEntries[0].data.equals(serializeReleaseManifest(manifest)),
    'Release manifest is not in exact canonical JSON form',
  );
  validateManifestShape(manifest);
  invariant(
    manifestEntries[0].path === `${manifest.releaseId}/release-manifest.json`,
    'Release manifest is not inside the matching release root',
  );
  const archiveFiles = verifyPayload(manifest, entries);
  const canonicalArchive = createTarGzipBuffer({
    rootName: manifest.releaseId,
    files: [...archiveFiles].map(([filePath, data]) => ({ path: filePath, data })),
  });
  invariant(archive.equals(canonicalArchive), 'Release archive bytes are not in canonical deterministic form');
  if (requireProductionEligible) verifyProductionEligibility(manifest, productionEvidence);
  return {
    manifest,
    archiveSha256,
    payloadFileCount: archiveFiles.size - 1,
    productionCandidate: manifest.productionEligibility.candidate,
    entries,
  };
};

export const verifyReleaseArchive = (options) => {
  const { entries: _entries, ...result } = verifyReleaseArchiveData(options);
  return result;
};

const inspectCanonicalExtractionRoot = (releasesDirectory) => {
  const resolvedRoot = path.resolve(releasesDirectory);
  invariant(existsSync(resolvedRoot), `Release extraction root does not exist: ${resolvedRoot}`);
  const rootStat = lstatSync(resolvedRoot);
  invariant(!rootStat.isSymbolicLink() && rootStat.isDirectory(), 'Release extraction root must be a real directory');
  const realRoot = realpathSync.native(resolvedRoot);
  invariant(
    pathsAreEqual(resolvedRoot, realRoot),
    'Release extraction root or one of its ancestors resolves through a symbolic link or junction',
  );
  const parentPath = path.dirname(realRoot);
  const parentStat = lstatSync(parentPath);
  invariant(!parentStat.isSymbolicLink() && parentStat.isDirectory(), 'Release extraction parent must be a real directory');
  if (typeof process.getuid === 'function') {
    const uid = process.getuid();
    invariant(rootStat.uid === uid, 'Release extraction root must be owned by the deployment process user');
    invariant(parentStat.uid === uid, 'Release extraction parent must be owned by the deployment process user');
    invariant((rootStat.mode & 0o022) === 0, 'Release extraction root cannot be group- or world-writable');
    invariant((parentStat.mode & 0o022) === 0, 'Release extraction parent cannot be group- or world-writable');
  }
  return {
    path: realRoot,
    identity: { dev: rootStat.dev, ino: rootStat.ino },
  };
};

const assertExtractionRootStable = (releaseRoot, identity) => {
  const stat = lstatSync(releaseRoot);
  invariant(!stat.isSymbolicLink() && stat.isDirectory(), 'Release extraction root changed during extraction');
  invariant(
    stat.dev === identity.dev && stat.ino === identity.ino && pathsAreEqual(realpathSync.native(releaseRoot), releaseRoot),
    'Release extraction root identity changed during extraction',
  );
};

const fsyncDirectory = (directoryPath) => {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directoryPath, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const writeExclusiveVerifiedFile = (filePath, data) => {
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(
    filePath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
    0o644,
  );
  try {
    writeFileSync(descriptor, data);
    fchmodSync(descriptor, 0o644);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const stat = lstatSync(filePath);
  invariant(!stat.isSymbolicLink() && stat.isFile(), `Extracted release path is not a regular file: ${filePath}`);
  invariant(readFileSync(filePath).equals(data), `Extracted release file verification failed: ${filePath}`);
};

export const extractVerifiedReleaseArchive = ({ releasesDirectory, ...verificationOptions }) => {
  invariant(
    typeof releasesDirectory === 'string' && releasesDirectory.length > 0,
    'releasesDirectory is required',
  );
  const {
    requireProductionEligible,
    expectedArchiveSha256,
    ...productionVerificationOptions
  } = verificationOptions;
  invariant(
    requireProductionEligible === undefined || requireProductionEligible === true,
    'Production release extraction cannot disable production eligibility verification',
  );
  invariant(
    typeof expectedArchiveSha256 === 'string'
      && SHA256_PATTERN.test(expectedArchiveSha256),
    'Trusted expected release archive SHA-256 is required as 64 lowercase hexadecimal characters',
  );
  const verified = verifyReleaseArchiveData({
    ...productionVerificationOptions,
    requireProductionEligible: true,
    expectedArchiveSha256,
  });
  const extractionRoot = inspectCanonicalExtractionRoot(releasesDirectory);
  const releaseRoot = extractionRoot.path;
  const finalPath = path.join(releaseRoot, verified.manifest.releaseId);
  invariant(pathIsWithin(releaseRoot, finalPath), 'Final release path escapes the extraction root');
  invariant(!existsSync(finalPath), `Release directory already exists: ${verified.manifest.releaseId}`);

  const temporaryPath = path.join(
    releaseRoot,
    `.extract-${verified.manifest.releaseId}-${randomUUID()}`,
  );
  invariant(pathIsWithin(releaseRoot, temporaryPath), 'Temporary release path escapes the extraction root');
  invariant(!existsSync(temporaryPath), 'Temporary release extraction path already exists');

  const reservationPath = path.join(releaseRoot, `.reserve-${verified.manifest.releaseId}`);
  invariant(pathIsWithin(releaseRoot, reservationPath), 'Release reservation path escapes the extraction root');
  let reservationDescriptor;
  let reservationCreated = false;
  let reservationIdentity = null;
  try {
    reservationDescriptor = openSync(
      reservationPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    reservationCreated = true;
    fchmodSync(reservationDescriptor, 0o600);
    const descriptorStat = fstatSync(reservationDescriptor, { bigint: true });
    const pathStat = lstatSync(reservationPath, { bigint: true });
    invariant(
      descriptorStat.isFile()
        && pathStat.isFile()
        && !pathStat.isSymbolicLink()
        && descriptorStat.nlink === 1n
        && sameFileIdentity(descriptorStat, pathStat),
      'Release extraction reservation changed while it was created',
    );
    reservationIdentity = { dev: descriptorStat.dev, ino: descriptorStat.ino };
    fsyncSync(reservationDescriptor);
  } catch (error) {
    if (reservationDescriptor !== undefined) closeSync(reservationDescriptor);
    const residue = reservationCreated
      ? ` Reservation residue was preserved at ${reservationPath} for operator inspection and trusted cleanup.`
      : '';
    throw new Error(`Release extraction reservation failed for ${verified.manifest.releaseId}: ${error.message}.${residue}`);
  }

  let temporaryCreated = false;
  let finalCommitted = false;
  let finalDurable = false;
  let operationError = null;
  let cleanupWarning = null;
  const createdDirectories = new Set();
  try {
    assertExtractionRootStable(releaseRoot, extractionRoot.identity);
    mkdirSync(temporaryPath, { mode: 0o700 });
    temporaryCreated = true;
    chmodSync(temporaryPath, 0o700);
    createdDirectories.add(temporaryPath);
    const rootPrefix = `${verified.manifest.releaseId}/`;
    for (const entry of verified.entries) {
      assertExtractionRootStable(releaseRoot, extractionRoot.identity);
      if (entry.path === verified.manifest.releaseId) {
        invariant(entry.type === 'directory', 'Release archive root must be a directory');
        continue;
      }
      invariant(entry.path.startsWith(rootPrefix), 'Release archive entry is outside its release root');
      const relativePath = entry.path.slice(rootPrefix.length);
      assertSafeRelativePath(relativePath, 'release extraction path');
      const destinationPath = path.resolve(temporaryPath, ...relativePath.split('/'));
      invariant(pathIsWithin(temporaryPath, destinationPath), 'Release extraction path escapes its temporary root');

      if (entry.type === 'directory') {
        mkdirSync(destinationPath, { mode: 0o755 });
        chmodSync(destinationPath, 0o755);
        createdDirectories.add(destinationPath);
        const directoryStat = lstatSync(destinationPath);
        invariant(
          !directoryStat.isSymbolicLink() && directoryStat.isDirectory(),
          `Extracted release path is not a real directory: ${relativePath}`,
        );
      } else {
        const parentPath = path.dirname(destinationPath);
        const parentStat = lstatSync(parentPath);
        invariant(
          !parentStat.isSymbolicLink() && parentStat.isDirectory(),
          `Extracted release parent is not a real directory: ${relativePath}`,
        );
        writeExclusiveVerifiedFile(destinationPath, entry.data);
      }
    }

    chmodSync(temporaryPath, 0o755);
    for (const directoryPath of [...createdDirectories].sort((left, right) => right.length - left.length)) {
      fsyncDirectory(directoryPath);
    }
    assertExtractionRootStable(releaseRoot, extractionRoot.identity);
    invariant(!existsSync(finalPath), `Release directory appeared during extraction: ${verified.manifest.releaseId}`);
    renameSync(temporaryPath, finalPath);
    temporaryCreated = false;
    finalCommitted = true;
    fsyncDirectory(releaseRoot);
    finalDurable = true;
  } catch (error) {
    const residueMessage = temporaryCreated
      ? ` Partial extraction residue was preserved at ${temporaryPath}; the release reservation was retained for operator inspection and trusted cleanup.`
      : '';
    operationError = finalCommitted && !finalDurable
      ? new Error(
          `Release ${verified.manifest.releaseId} was committed at ${finalPath}, but directory durability could not be confirmed: ${error.message}. Inspect the final path before retrying.`,
          { cause: error },
        )
      : new Error(
          `${error instanceof Error ? error.message : String(error)}${residueMessage}`,
          { cause: error },
        );
  } finally {
    if (reservationDescriptor !== undefined) {
      try {
        closeSync(reservationDescriptor);
      } catch (error) {
        cleanupWarning = `Could not close release reservation: ${error.message}`;
      }
    }
    if (
      reservationCreated
        && ((!finalCommitted && !temporaryCreated) || finalDurable)
        && existsSync(reservationPath)
    ) {
      try {
        const currentReservation = lstatSync(reservationPath, { bigint: true });
        invariant(
          reservationIdentity
            && currentReservation.isFile()
            && !currentReservation.isSymbolicLink()
            && currentReservation.nlink === 1n
            && sameFileIdentity(currentReservation, reservationIdentity),
          'Release reservation identity changed before cleanup',
        );
        unlinkSync(reservationPath);
        fsyncDirectory(releaseRoot);
      } catch (error) {
        const message = `Could not durably remove release reservation ${reservationPath}: ${error.message}`;
        if (operationError) {
          cleanupWarning = cleanupWarning ? `${cleanupWarning}; ${message}` : message;
        } else if (finalDurable) {
          cleanupWarning = cleanupWarning ? `${cleanupWarning}; ${message}` : message;
        } else {
          operationError = new Error(message, { cause: error });
        }
      }
    }
  }

  if (operationError) {
    if (cleanupWarning) operationError.message = `${operationError.message} Cleanup warning: ${cleanupWarning}`;
    throw operationError;
  }

  const { entries: _entries, ...result } = verified;
  return {
    ...result,
    destinationPath: finalPath,
    warnings: cleanupWarning ? [cleanupWarning] : [],
  };
};
