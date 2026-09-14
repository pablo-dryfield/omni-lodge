import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateUiArtifact } from '../../ui-server/uiArtifactValidation.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const configuredBuildPath = (process.env.UI_BUILD_PATH ?? '').trim();
const buildPath = path.resolve(
  repositoryRoot,
  configuredBuildPath || path.join('ui', 'build'),
);
const shouldStamp = process.argv.includes('--stamp');
const releaseId = (process.env.CI_RELEASE_ID ?? '').trim();
const gitSha = (process.env.GIT_COMMIT_SHA ?? '').trim().toLowerCase();

const fail = (message) => {
  throw new Error(`UI build verification failed: ${message}`);
};

if (shouldStamp) {
  if (!releaseId) fail('CI_RELEASE_ID is required when --stamp is used');
  if (!/^[a-f0-9]{40}$/.test(gitSha)) {
    fail('GIT_COMMIT_SHA must be a full 40-character hexadecimal commit SHA');
  }

  fs.writeFileSync(
    path.join(buildPath, 'release-metadata.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      releaseId,
      gitSha,
    }, null, 2)}\n`,
    'utf8',
  );
}

// Validate the complete tree before reading individual assets so nested
// symlinks or special files cannot be followed by the source-map checks.
const validation = validateUiArtifact({
  buildPath,
  expectedRelease: releaseId || null,
});

const walkFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });

const staticPath = path.join(buildPath, 'static');
try {
  if (!fs.statSync(staticPath).isDirectory()) fail('static asset path is not a directory');
} catch {
  fail('static asset directory is missing or unreadable');
}

const staticSourceAssets = walkFiles(staticPath)
  .filter((filePath) => /\.(?:css|js)$/i.test(filePath));

if (staticSourceAssets.length === 0) fail('no static JavaScript or CSS assets were emitted');
const sourceAssets = [...staticSourceAssets, path.join(buildPath, 'service-worker.js')];

for (const assetPath of sourceAssets) {
  let assetStat;
  try {
    assetStat = fs.statSync(assetPath);
  } catch {
    fail(`${path.relative(buildPath, assetPath)} is missing or unreadable`);
  }
  if (!assetStat.isFile()) {
    fail(`${path.relative(buildPath, assetPath)} is not a regular file`);
  }

  const mapPath = `${assetPath}.map`;
  let mapStat;
  try {
    mapStat = fs.statSync(mapPath);
  } catch {
    fail(`${path.relative(buildPath, mapPath)} is missing`);
  }
  if (!mapStat.isFile() || mapStat.size === 0) {
    fail(`${path.relative(buildPath, mapPath)} is empty or not a regular file`);
  }

  const assetText = fs.readFileSync(assetPath, 'utf8');
  if (!assetText.includes(`sourceMappingURL=${path.basename(mapPath)}`)) {
    fail(`${path.relative(buildPath, assetPath)} does not reference its source map`);
  }

  let sourceMap;
  try {
    sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch {
    fail(`${path.relative(buildPath, mapPath)} is not valid JSON`);
  }
  const sourcesAreUsable = Array.isArray(sourceMap?.sources)
    && sourceMap.sources.length > 0
    && sourceMap.sources.every((source) => typeof source === 'string' && source.length > 0);
  const sourcesContentIsUsable = Array.isArray(sourceMap?.sourcesContent)
    && sourceMap.sourcesContent.length === sourceMap.sources.length
    && sourceMap.sourcesContent.every((content) => typeof content === 'string');
  if (
    sourceMap?.version !== 3
    || typeof sourceMap.mappings !== 'string'
    || sourceMap.mappings.length === 0
    || !sourcesAreUsable
    || !sourcesContentIsUsable
  ) {
    fail(`${path.relative(buildPath, mapPath)} is not a usable source-map v3 document`);
  }
}

if (releaseId) {
  const manifest = JSON.parse(fs.readFileSync(path.join(buildPath, 'asset-manifest.json'), 'utf8'));
  const mainAssetPath = String(manifest?.files?.['main.js'] ?? '').replace(/^\/+/, '');
  if (!mainAssetPath) fail('asset-manifest.json does not identify main.js');

  const mainBundle = fs.readFileSync(path.join(buildPath, mainAssetPath), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(buildPath, 'service-worker.js'), 'utf8');
  if (!mainBundle.includes(releaseId)) fail('the main JavaScript bundle does not embed CI_RELEASE_ID');
  if (!serviceWorker.includes(releaseId)) fail('the service worker does not embed CI_RELEASE_ID');
}

console.log(JSON.stringify({
  status: validation.status,
  release: validation.release,
  mainAsset: validation.mainAsset,
  referencedAssets: validation.assetCount,
  sourceMappedAssets: sourceAssets.length,
}));
