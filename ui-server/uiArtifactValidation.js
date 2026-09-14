import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HASHED_ASSET_NAME = /(?:^|\/)[^/]+\.[a-f0-9]{8,}(?:\.[^/]+)*\.(?:css|js|png|jpe?g|gif|svg|webp|woff2?|ttf|ico|map)$/i;
const MAIN_JAVASCRIPT_NAME = /(?:^|\/)main\.([a-f0-9]{8,})\.js$/i;
const RELEASE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const MAX_VALIDATION_PROBLEMS = 50;

export class UiArtifactValidationError extends Error {
  constructor(problems) {
    const boundedProblems = problems.slice(0, MAX_VALIDATION_PROBLEMS);
    const omitted = Math.max(0, problems.length - boundedProblems.length);
    super(
      `UI artifact validation failed: ${boundedProblems.join('; ')}`
      + (omitted > 0 ? `; ${omitted} additional problem(s) omitted` : ''),
    );
    this.name = 'UiArtifactValidationError';
    this.problems = boundedProblems;
  }
}

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);

const isContainedPath = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const parseLocalAssetPath = (rawValue, label, problems, { allowExternal = false } = {}) => {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    problems.push(`${label} must be a non-empty asset path`);
    return null;
  }

  const rawPath = rawValue.trim();
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawPath)) {
    if (!allowExternal) problems.push(`${label} must reference a local build asset`);
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(rawPath.split(/[?#]/, 1)[0]);
  } catch {
    problems.push(`${label} contains invalid URL encoding`);
    return null;
  }

  const normalized = pathname.replace(/^\/+/, '').replaceAll('\\', '/');
  if (
    normalized.length === 0
    || normalized.includes('\0')
    || normalized.split('/').some((segment) => segment === '..')
  ) {
    problems.push(`${label} is not a safe build-relative path`);
    return null;
  }

  return normalized;
};

const readRequiredText = ({
  buildRoot,
  realBuildRoot,
  relativePath,
  label,
  problems,
  readContents = true,
}) => {
  const normalized = parseLocalAssetPath(relativePath, label, problems);
  if (!normalized) return null;

  const candidate = path.resolve(buildRoot, ...normalized.split('/'));
  if (!isContainedPath(path.resolve(buildRoot), candidate)) {
    problems.push(`${label} escapes the UI build directory`);
    return null;
  }

  try {
    const linkStat = fs.lstatSync(candidate);
    if (linkStat.isSymbolicLink()) {
      problems.push(`${label} must not be a symbolic link`);
      return null;
    }
    if (!linkStat.isFile()) {
      problems.push(`${label} is not a regular file`);
      return null;
    }
    if (linkStat.size === 0) {
      problems.push(`${label} is empty`);
      return null;
    }
    fs.accessSync(candidate, fs.constants.R_OK);
    const realCandidate = fs.realpathSync(candidate);
    if (!isContainedPath(realBuildRoot, realCandidate)) {
      problems.push(`${label} resolves outside the UI build directory`);
      return null;
    }
    if (!readContents) return normalized;
    const contents = fs.readFileSync(candidate, 'utf8');
    return contents;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    problems.push(`${label} is missing or unreadable${code ? ` (${code})` : ''}`);
    return null;
  }
};

const readRequiredJson = (input) => {
  const text = readRequiredText(input);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      input.problems.push(`${input.label} must contain a JSON object`);
      return null;
    }
    return parsed;
  } catch {
    input.problems.push(`${input.label} contains invalid JSON`);
    return null;
  }
};

const extractHtmlReferences = (html) => [...html.matchAll(
  /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
)].map((match) => match[1]);

const extractHtmlRelease = (html) => {
  for (const name of ['app-version', 'build-id']) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameFirst = html.match(new RegExp(
      `<meta\\s+[^>]*name=["']${escapedName}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'i',
    ));
    if (nameFirst?.[1]?.trim()) return nameFirst[1].trim();
    const contentFirst = html.match(new RegExp(
      `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*name=["']${escapedName}["'][^>]*>`,
      'i',
    ));
    if (contentFirst?.[1]?.trim()) return contentFirst[1].trim();
  }
  return null;
};

const addReleaseCandidate = (candidates, source, value) => {
  if (typeof value === 'string' && value.trim()) {
    candidates.push({ source, value: value.trim() });
  }
};

const validateJavaScriptSyntax = (contents, label, problems) => {
  try {
    new vm.Script(contents, { filename: label });
  } catch {
    problems.push(`${label} contains invalid JavaScript`);
  }
};

const releaseFromObject = (value) => {
  if (!isPlainObject(value)) return null;
  return [
    value.releaseId,
    value.release,
    value.version,
    isPlainObject(value.build) ? value.build.release : null,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() ?? null;
};

const collectManifestAssetReferences = (manifest, problems) => {
  const references = [];
  if (!isPlainObject(manifest?.files) || Object.keys(manifest.files).length === 0) {
    problems.push('asset-manifest.json must contain a non-empty files object');
  } else {
    for (const [name, assetPath] of Object.entries(manifest.files)) {
      references.push({ value: assetPath, label: `asset-manifest.json files.${name}` });
    }
  }

  if (!Array.isArray(manifest?.entrypoints) || manifest.entrypoints.length === 0) {
    problems.push('asset-manifest.json must contain non-empty entrypoints');
  } else {
    manifest.entrypoints.forEach((assetPath, index) => {
      references.push({ value: assetPath, label: `asset-manifest.json entrypoints[${index}]` });
    });
  }
  return references;
};

const collectWebManifestReferences = (manifest, label, problems) => {
  const references = [];
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    problems.push(`${label} must define name`);
  }
  if (typeof manifest.start_url !== 'string' || !manifest.start_url.trim()) {
    problems.push(`${label} must define start_url`);
  }
  if (typeof manifest.display !== 'string' || !manifest.display.trim()) {
    problems.push(`${label} must define display`);
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    problems.push(`${label} must define at least one icon`);
  }

  const addItems = (items, collectionName) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      if (!isPlainObject(item)) {
        problems.push(`${label} ${collectionName}[${index}] must be an object`);
        return;
      }
      references.push({
        value: item.src,
        label: `${label} ${collectionName}[${index}].src`,
      });
    });
  };

  addItems(manifest.icons, 'icons');
  addItems(manifest.screenshots, 'screenshots');
  if (Array.isArray(manifest.shortcuts)) {
    manifest.shortcuts.forEach((shortcut, shortcutIndex) => {
      addItems(shortcut?.icons, `shortcuts[${shortcutIndex}].icons`);
    });
  }
  return references;
};

const validateReferencedFile = ({
  buildRoot,
  realBuildRoot,
  reference,
  problems,
  validatedPaths,
}) => {
  const normalized = parseLocalAssetPath(
    reference.value,
    reference.label,
    problems,
    { allowExternal: reference.allowExternal === true },
  );
  if (!normalized || validatedPaths.has(normalized)) return normalized;
  validatedPaths.add(normalized);
  readRequiredText({
    buildRoot,
    realBuildRoot,
    relativePath: normalized,
    label: reference.label,
    problems,
    readContents: false,
  });
  return normalized;
};

const readOptionalReleaseMetadata = ({ buildRoot, realBuildRoot, problems }) => {
  const candidates = [
    path.join(buildRoot, 'release-metadata.json'),
    path.resolve(buildRoot, '..', '..', 'release-manifest.json'),
  ];
  const metadata = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const linkStat = fs.lstatSync(candidate);
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        problems.push(`${path.basename(candidate)} must be a regular, non-symlink file`);
        continue;
      }
      fs.accessSync(candidate, fs.constants.R_OK);
      const candidateIsInsideBuild = isContainedPath(path.resolve(buildRoot), path.resolve(candidate));
      if (candidateIsInsideBuild && !isContainedPath(realBuildRoot, fs.realpathSync(candidate))) {
        problems.push(`${path.basename(candidate)} resolves outside the UI build directory`);
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (!isPlainObject(parsed)) {
        problems.push(`${path.basename(candidate)} must contain a JSON object`);
        continue;
      }
      const value = releaseFromObject(parsed);
      if (!value) problems.push(`${path.basename(candidate)} does not define a release ID`);
      metadata.push({ source: path.basename(candidate), value });
    } catch {
      problems.push(`${path.basename(candidate)} is unreadable or contains invalid JSON`);
    }
  }
  return metadata;
};

export const validateUiArtifact = ({
  buildPath,
  expectedRelease = null,
  validatedAt = new Date(),
} = {}) => {
  const problems = [];
  if (typeof buildPath !== 'string' || !buildPath.trim()) {
    throw new UiArtifactValidationError(['UI build path is required']);
  }

  const buildRoot = path.resolve(buildPath);
  let realBuildRoot = buildRoot;
  try {
    const buildStat = fs.statSync(buildRoot);
    if (!buildStat.isDirectory()) problems.push('UI build path is not a directory');
    fs.accessSync(buildRoot, fs.constants.R_OK);
    realBuildRoot = fs.realpathSync(buildRoot);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    throw new UiArtifactValidationError([
      `UI build path is missing or unreadable${code ? ` (${code})` : ''}`,
    ]);
  }

  const readText = (relativePath, label) => readRequiredText({
    buildRoot,
    realBuildRoot,
    relativePath,
    label,
    problems,
  });
  const readJson = (relativePath, label) => readRequiredJson({
    buildRoot,
    realBuildRoot,
    relativePath,
    label,
    problems,
  });

  const indexHtml = readText('index.html', 'index.html');
  if (indexHtml && (
    !/<html\b/i.test(indexHtml)
    || !/<head\b/i.test(indexHtml)
    || !/<body\b/i.test(indexHtml)
    || !/<div\b[^>]*\bid=["']root["']/i.test(indexHtml)
  )) {
    problems.push('index.html is not a valid OmniLodge application shell');
  }

  const assetManifest = readJson('asset-manifest.json', 'asset-manifest.json');
  const references = [];
  if (indexHtml) {
    extractHtmlReferences(indexHtml).forEach((value, index) => {
      references.push({
        value,
        label: `index.html reference[${index}]`,
        allowExternal: true,
      });
    });
  }
  if (assetManifest) references.push(...collectManifestAssetReferences(assetManifest, problems));

  const requiredPwaFiles = [
    ['service-worker.js', 'service-worker.js'],
    ['manifest.json', 'manifest.json'],
    ['pwa-manifest-selector.js', 'pwa-manifest-selector.js'],
  ];
  requiredPwaFiles.forEach(([value, label]) => references.push({ value, label }));

  const validatedPaths = new Set();
  references.forEach((reference) => validateReferencedFile({
    buildRoot,
    realBuildRoot,
    reference,
    problems,
    validatedPaths,
  }));

  const mainAssetRaw = assetManifest?.files?.['main.js'];
  const mainAsset = parseLocalAssetPath(
    mainAssetRaw,
    'asset-manifest.json files.main.js',
    problems,
  );
  const mainHash = mainAsset?.match(MAIN_JAVASCRIPT_NAME)?.[1] ?? null;
  if (!mainHash) {
    problems.push('asset-manifest.json main.js must use a content-hashed filename');
  }
  if (indexHtml && mainAsset && !extractHtmlReferences(indexHtml).some((reference) => {
    const localPath = parseLocalAssetPath(
      reference,
      'index.html main script',
      [],
      { allowExternal: true },
    );
    return localPath === mainAsset;
  })) {
    problems.push('index.html does not reference the manifest main.js asset');
  }
  if (
    mainAsset
    && Array.isArray(assetManifest?.entrypoints)
    && !assetManifest.entrypoints.some((entrypoint) => {
      const localPath = parseLocalAssetPath(entrypoint, 'asset-manifest.json main entrypoint', []);
      return localPath === mainAsset;
    })
  ) {
    problems.push('asset-manifest.json entrypoints does not include main.js');
  }

  const mainWebManifest = readJson('manifest.json', 'manifest.json');
  const pwaManifestPaths = new Set(['manifest.json']);
  if (mainWebManifest) {
    collectWebManifestReferences(mainWebManifest, 'manifest.json', problems)
      .forEach((reference) => validateReferencedFile({
        buildRoot,
        realBuildRoot,
        reference,
        problems,
        validatedPaths,
      }));
  }

  const manifestSelector = readText('pwa-manifest-selector.js', 'pwa-manifest-selector.js');
  if (indexHtml && !indexHtml.includes('/pwa-manifest-selector.js')) {
    problems.push('index.html does not load pwa-manifest-selector.js');
  }
  if (manifestSelector) {
    validateJavaScriptSyntax(manifestSelector, 'pwa-manifest-selector.js', problems);
    for (const match of manifestSelector.matchAll(/["'](\/?[^"']+\.(?:webmanifest|json))["']/gi)) {
      const normalized = parseLocalAssetPath(match[1], 'PWA manifest selector reference', problems);
      if (!normalized || (!normalized.endsWith('.webmanifest') && normalized !== 'manifest.json')) continue;
      pwaManifestPaths.add(normalized);
    }
  }

  for (const manifestPath of pwaManifestPaths) {
    if (manifestPath === 'manifest.json') continue;
    const manifest = readJson(manifestPath, manifestPath);
    if (!manifest) continue;
    collectWebManifestReferences(manifest, manifestPath, problems)
      .forEach((reference) => validateReferencedFile({
        buildRoot,
        realBuildRoot,
        reference,
        problems,
        validatedPaths,
      }));
  }

  const serviceWorker = readText('service-worker.js', 'service-worker.js');
  if (serviceWorker) {
    validateJavaScriptSyntax(serviceWorker, 'service-worker.js', problems);
    if (!/self\.addEventListener\s*\(\s*["'](?:install|fetch)["']/.test(serviceWorker)) {
      problems.push('service-worker.js does not contain a service-worker event handler');
    }
    for (const match of serviceWorker.matchAll(/\burl\s*:\s*["']([^"']+)["']/gi)) {
      const candidate = match[1];
      if (!/\.[A-Za-z0-9]{1,12}(?:[?#]|$)/.test(candidate)) continue;
      validateReferencedFile({
        buildRoot,
        realBuildRoot,
        reference: { value: candidate, label: 'service-worker.js precache reference' },
        problems,
        validatedPaths,
      });
    }
  }

  const hashedReferences = [...validatedPaths].filter((value) => HASHED_ASSET_NAME.test(value));
  if (hashedReferences.length === 0) {
    problems.push('UI artifact does not reference any content-hashed assets');
  }

  const releaseCandidates = [];
  addReleaseCandidate(releaseCandidates, 'asset-manifest.json', releaseFromObject(assetManifest));
  addReleaseCandidate(releaseCandidates, 'index.html', indexHtml ? extractHtmlRelease(indexHtml) : null);
  const releaseMetadata = readOptionalReleaseMetadata({ buildRoot, realBuildRoot, problems });
  releaseMetadata.forEach((candidate) => {
    addReleaseCandidate(releaseCandidates, candidate.source, candidate.value);
  });

  const normalizedExpectedRelease = typeof expectedRelease === 'string' && expectedRelease.trim()
    ? expectedRelease.trim()
    : null;
  if (normalizedExpectedRelease && !RELEASE_TOKEN.test(normalizedExpectedRelease)) {
    problems.push('expected UI release is not a valid release identifier');
  }
  releaseCandidates.forEach((candidate) => {
    if (!RELEASE_TOKEN.test(candidate.value)) {
      problems.push(`${candidate.source} contains an invalid release identifier`);
    }
  });
  const distinctReleases = new Set(releaseCandidates.map((candidate) => candidate.value));
  if (distinctReleases.size > 1) {
    problems.push('UI release metadata sources are inconsistent');
  }
  if (normalizedExpectedRelease && releaseCandidates.length === 0) {
    problems.push('expected UI release metadata is missing from the artifact');
  }
  if (
    normalizedExpectedRelease
    && releaseCandidates.some((candidate) => candidate.value !== normalizedExpectedRelease)
  ) {
    problems.push('UI release metadata does not match the expected release');
  }

  if (problems.length > 0) throw new UiArtifactValidationError(problems);

  const explicitRelease = releaseCandidates[0]?.value ?? null;
  return Object.freeze({
    status: 'valid',
    validatedAt: validatedAt instanceof Date ? validatedAt.toISOString() : String(validatedAt),
    release: normalizedExpectedRelease ?? explicitRelease ?? `web-${mainHash}`,
    releaseSource: normalizedExpectedRelease
      ? 'expected'
      : releaseCandidates[0]?.source ?? 'main-asset-hash',
    mainAsset: `/${mainAsset}`,
    assetCount: validatedPaths.size,
    hashedAssetCount: hashedReferences.length,
    pwaManifestCount: pwaManifestPaths.size,
  });
};
