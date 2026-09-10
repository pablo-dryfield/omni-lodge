import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer, type RawSourceMap } from 'source-map';

const MAX_SOURCE_MAP_BYTES = 32 * 1024 * 1024;
const MAX_STACK_FRAMES = 50;
const MAX_INDEXED_FILES = 20_000;
const MAX_CONSUMER_CACHE = 20;
const ARCHIVE_INDEX_TTL_MS = 60_000;
const ARCHIVE_MISS_REFRESH_MS = 5_000;
const BUNDLE_LOCATION = /((?:https?:\/\/[^\s)/]+)?\/static\/js\/([A-Za-z0-9._-]+\.js)):(\d+):(\d+)/g;

type SymbolicationOptions = {
  buildRoot?: string;
  archiveRoot?: string;
};

type CachedConsumer = {
  consumer: SourceMapConsumer;
  lastUsedAt: number;
};

type CachedArchiveIndex = {
  files: Map<string, string>;
  builtAt: number;
  nextMissRefreshAt: number;
};

// Production normally starts with `be` as cwd while Jest/maintenance commands
// may start at the repository root. Avoid import.meta here so the service stays
// compatible with the project's Jest/Babel CommonJS transform as well as ESM.
const defaultBuildRoots = [
  path.resolve(process.cwd(), '..', 'ui', 'build'),
  path.resolve(process.cwd(), 'ui', 'build'),
];
const defaultArchiveRoots = process.env.ERROR_MONITORING_SOURCE_MAP_DIR
  ? [path.resolve(process.env.ERROR_MONITORING_SOURCE_MAP_DIR)]
  : [
      path.resolve(process.cwd(), '..', 'runtime', 'error-monitoring', 'source-maps'),
      path.resolve(process.cwd(), 'runtime', 'error-monitoring', 'source-maps'),
    ];
const consumerCache = new Map<string, CachedConsumer>();
const archiveIndexes = new Map<string, CachedArchiveIndex>();

const normalizeRelease = (value: string | null | undefined): string => String(value || '')
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);

const isContained = (root: string, candidate: string): boolean => {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
};

const buildArchiveIndex = (archiveRoot: string, force = false): Map<string, string> => {
  const now = Date.now();
  const existing = archiveIndexes.get(archiveRoot);
  if (existing && !force && now - existing.builtAt < ARCHIVE_INDEX_TTL_MS) return existing.files;
  const index = new Map<string, string>();
  const pending = [archiveRoot];
  let inspected = 0;
  while (pending.length > 0 && inspected < MAX_INDEXED_FILES) {
    const directory = pending.pop() as string;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      inspected += 1;
      if (inspected > MAX_INDEXED_FILES) break;
      const absolutePath = path.join(directory, entry.name);
      if (!isContained(archiveRoot, absolutePath)) continue;
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.js.map')) {
        const previous = index.get(entry.name);
        try {
          if (!previous || statSync(absolutePath).mtimeMs > statSync(previous).mtimeMs) {
            index.set(entry.name, absolutePath);
          }
        } catch {
          // A concurrently replaced archive entry can disappear during indexing.
        }
      }
    }
  }
  archiveIndexes.set(archiveRoot, {
    files: index,
    builtAt: now,
    nextMissRefreshAt: now + ARCHIVE_MISS_REFRESH_MS,
  });
  return index;
};

const locateSourceMap = (
  bundleFilename: string,
  release: string | null | undefined,
  options: SymbolicationOptions,
): string | null => {
  if (!/^[A-Za-z0-9._-]+\.js$/.test(bundleFilename)) return null;
  const buildRoots = options.buildRoot
    ? [path.resolve(options.buildRoot)]
    : defaultBuildRoots;
  const archiveRoots = options.archiveRoot
    ? [path.resolve(options.archiveRoot)]
    : defaultArchiveRoots;
  const mapFilename = `${bundleFilename}.map`;
  const normalizedRelease = normalizeRelease(release);
  // A delayed error must use the map archived for its own release even if the
  // current deployment happens to contain a bundle with the same filename.
  for (const archiveRoot of archiveRoots) {
    if (normalizedRelease) {
      const candidate = path.join(archiveRoot, normalizedRelease, 'static', 'js', mapFilename);
      if (isContained(archiveRoot, candidate) && existsSync(candidate)) return candidate;
    }
  }
  // Hashed bundle names make this current-build fallback safe: it is used only
  // when the exact filename referenced by the stack exists in the current build.
  for (const buildRoot of buildRoots) {
    const candidate = path.join(buildRoot, 'static', 'js', mapFilename);
    if (isContained(buildRoot, candidate) && existsSync(candidate)) return candidate;
  }
  for (const archiveRoot of archiveRoots) {
    const previous = archiveIndexes.get(archiveRoot);
    let indexedFiles = buildArchiveIndex(archiveRoot);
    let indexed = indexedFiles.get(mapFilename);
    if (indexed && !existsSync(indexed)) indexed = undefined;
    const current = archiveIndexes.get(archiveRoot);
    // Re-scan a cached index on a throttled miss. This lets a long-running API
    // discover archives created by later UI deployments without scanning the
    // tree for every unknown frame.
    if (!indexed
      && previous != null
      && current === previous
      && Date.now() >= current.nextMissRefreshAt) {
      indexedFiles = buildArchiveIndex(archiveRoot, true);
      indexed = indexedFiles.get(mapFilename);
    }
    if (indexed && existsSync(indexed)) return indexed;
  }
  return null;
};

const loadConsumer = (mapPath: string): SourceMapConsumer | null => {
  const cached = consumerCache.get(mapPath);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.consumer;
  }
  try {
    const mapStats = statSync(mapPath);
    if (!mapStats.isFile() || mapStats.size <= 0 || mapStats.size > MAX_SOURCE_MAP_BYTES) return null;
    const parsed = JSON.parse(readFileSync(mapPath, 'utf8')) as RawSourceMap;
    if (String(parsed.version) !== '3' || !Array.isArray(parsed.sources) || typeof parsed.mappings !== 'string') {
      return null;
    }
    const consumer = new SourceMapConsumer(parsed);
    consumerCache.set(mapPath, { consumer, lastUsedAt: Date.now() });
    if (consumerCache.size > MAX_CONSUMER_CACHE) {
      const oldest = [...consumerCache.entries()]
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0]?.[0];
      if (oldest) consumerCache.delete(oldest);
    }
    return consumer;
  } catch {
    return null;
  }
};

const sanitizeOriginalSource = (source: string | null): string | null => {
  if (!source) return null;
  const normalized = source
    .replace(/^webpack:\/\//i, '')
    .replace(/^\.?\//, '')
    .replace(/\\/g, '/')
    .replace(/^.*?\/src\//, 'src/');
  if (!/^[A-Za-z0-9_@./~-]+$/.test(normalized)) return null;
  return normalized.slice(0, 500);
};

/**
 * Adds private original-source locations to production browser stack frames.
 * It never reads `sourcesContent`, never exposes a map, and returns the original
 * bounded stack unchanged if a map cannot be found or parsed.
 */
export const symbolicateBrowserStack = (
  stack: string | null | undefined,
  release?: string | null,
  options: SymbolicationOptions = {},
): string | null => {
  if (!stack) return stack ?? null;
  let frameCount = 0;
  let changed = false;
  const symbolicated = stack.split(/\r?\n/).map((line) => {
    if (frameCount >= MAX_STACK_FRAMES) return line;
    return line.replace(BUNDLE_LOCATION, (generated, _asset, bundleFilename, lineText, columnText) => {
      if (frameCount >= MAX_STACK_FRAMES) return generated;
      frameCount += 1;
      const mapPath = locateSourceMap(bundleFilename, release, options);
      if (!mapPath) return generated;
      const consumer = loadConsumer(mapPath);
      if (!consumer) return generated;
      const generatedLine = Number(lineText);
      const generatedColumn = Math.max(0, Number(columnText) - 1);
      if (!Number.isSafeInteger(generatedLine) || generatedLine < 1 || !Number.isSafeInteger(generatedColumn)) {
        return generated;
      }
      try {
        const original = consumer.originalPositionFor({ line: generatedLine, column: generatedColumn });
        const source = sanitizeOriginalSource(original.source);
        if (!source || !original.line) return generated;
        changed = true;
        const functionName = original.name && /^[A-Za-z0-9_$.[\]<> -]{1,160}$/.test(original.name)
          ? ` (${original.name})`
          : '';
        return `${generated} -> ${source}:${original.line}:${original.column ?? 0}${functionName}`;
      } catch {
        return generated;
      }
    });
  }).join('\n');
  return changed ? symbolicated.slice(0, 30_000) : stack.slice(0, 30_000);
};

export const resetBrowserStackSymbolicationCachesForTests = (): void => {
  consumerCache.clear();
  archiveIndexes.clear();
};
