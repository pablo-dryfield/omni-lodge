import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const RELEASE_NAME = /[^A-Za-z0-9._-]+/g;

export const normalizeSourceMapRelease = (value, fallback = 'unversioned') => {
  const normalized = String(value || '')
    .trim()
    .replace(RELEASE_NAME, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (normalized && normalized !== '.' && normalized !== '..') return normalized;
  const safeFallback = String(fallback || 'unversioned')
    .trim()
    .replace(RELEASE_NAME, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return safeFallback && safeFallback !== '.' && safeFallback !== '..'
    ? safeFallback
    : 'unversioned';
};

export const isSourceMapRequest = (requestPath) => {
  let candidate = String(requestPath || '').split(/[?#]/, 1)[0];
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    }
  } catch {
    // A malformed path cannot match a real static source-map filename.
  }
  return candidate.toLowerCase().endsWith('.map');
};

export const denyPublicSourceMaps = (req, res, next) => {
  if (!isSourceMapRequest(req?.path || req?.url)) {
    next();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(404).type('text/plain').send('Not Found');
};

const walkSourceMaps = (root, current = root, result = []) => {
  if (result.length >= 10_000) return result;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (result.length >= 10_000) break;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkSourceMaps(root, absolutePath, result);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.map')) {
      result.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath),
      });
    }
  }
  return result;
};

const ensureContainedPath = (root, candidate) => {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
};

const hashFile = (filePath) => createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

const filesMatch = (sourcePath, destinationPath, sourceStat) => {
  try {
    if (!fs.existsSync(destinationPath)) return false;
    if (fs.statSync(destinationPath).size !== sourceStat.size) return false;
    return hashFile(sourcePath) === hashFile(destinationPath);
  } catch {
    return false;
  }
};

const replaceFileAtomically = (temporaryPath, destination) => {
  if (process.platform !== 'win32' || !fs.existsSync(destination)) {
    fs.renameSync(temporaryPath, destination);
    return;
  }

  const backupPath = `${destination}.${process.pid}.bak`;
  try {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    fs.renameSync(destination, backupPath);
    try {
      fs.renameSync(temporaryPath, destination);
    } catch (error) {
      fs.renameSync(backupPath, destination);
      throw error;
    }
    fs.unlinkSync(backupPath);
  } finally {
    if (fs.existsSync(backupPath) && fs.existsSync(destination)) fs.unlinkSync(backupPath);
  }
};

/**
 * Copies CRA source maps outside the publicly served build tree. The originals
 * remain in place for deploy/debug tooling, but server middleware denies every
 * public `.map` request. Hashed map names are immutable, so existing copies do
 * not need to be rewritten on each process restart.
 */
const pruneOldReleases = (archiveRoot, currentRelease, maxReleases) => {
  let releaseDirectories;
  try {
    releaseDirectories = fs.readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const absolutePath = path.join(archiveRoot, entry.name);
        return { name: entry.name, absolutePath, modifiedAt: fs.statSync(absolutePath).mtimeMs };
      })
      .sort((left, right) =>
        (right.modifiedAt - left.modifiedAt) || right.name.localeCompare(left.name));
  } catch {
    return 0;
  }
  const keep = new Set([
    currentRelease,
    ...releaseDirectories
      .filter((entry) => entry.name !== currentRelease)
      .slice(0, Math.max(0, maxReleases - 1))
      .map((entry) => entry.name),
  ]);
  let pruned = 0;
  for (const entry of releaseDirectories) {
    if (keep.has(entry.name) || !ensureContainedPath(archiveRoot, entry.absolutePath)) continue;
    fs.rmSync(entry.absolutePath, { recursive: true, force: true });
    pruned += 1;
  }
  return pruned;
};

export const archiveSourceMaps = ({ buildRoot, archiveRoot, release, maxReleases = 20 }) => {
  const normalizedRelease = normalizeSourceMapRelease(release);
  const boundedMaxReleases = Number.isFinite(Number(maxReleases))
    ? Math.max(2, Math.min(100, Math.floor(Number(maxReleases))))
    : 20;
  const releaseRoot = path.join(archiveRoot, normalizedRelease);
  if (
    path.resolve(releaseRoot) === path.resolve(archiveRoot)
    || !ensureContainedPath(archiveRoot, releaseRoot)
  ) {
    throw new Error('Invalid source-map archive release path');
  }
  if (
    ensureContainedPath(buildRoot, archiveRoot)
    || ensureContainedPath(archiveRoot, buildRoot)
  ) {
    throw new Error('Source-map archive and public build directories must be separate');
  }
  if (!fs.existsSync(buildRoot)) {
    return { release: normalizedRelease, discovered: 0, copied: 0, bytes: 0, prunedReleases: 0 };
  }

  const maps = walkSourceMaps(buildRoot);
  let copied = 0;
  let bytes = 0;
  fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(archiveRoot, 0o700);
  fs.mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(releaseRoot, 0o700);

  for (const source of maps) {
    const destination = path.join(releaseRoot, source.relativePath);
    if (!ensureContainedPath(releaseRoot, destination)) continue;
    const sourceStat = fs.statSync(source.absolutePath);
    bytes += sourceStat.size;
    const destinationMatches = filesMatch(source.absolutePath, destination, sourceStat);
    if (destinationMatches) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporaryPath = `${destination}.${process.pid}.tmp`;
    try {
      fs.copyFileSync(source.absolutePath, temporaryPath);
      fs.chmodSync(temporaryPath, 0o600);
      if (hashFile(source.absolutePath) !== hashFile(temporaryPath)) {
        throw new Error(`Source-map archive verification failed for ${source.relativePath}`);
      }
      replaceFileAtomically(temporaryPath, destination);
      fs.chmodSync(destination, 0o600);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    copied += 1;
  }

  const now = new Date();
  fs.utimesSync(releaseRoot, now, now);
  const prunedReleases = pruneOldReleases(archiveRoot, normalizedRelease, boundedMaxReleases);

  return { release: normalizedRelease, discovered: maps.length, copied, bytes, prunedReleases };
};
