#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { packageRelease, parseStrictCliArguments } from './lib.mjs';

const VALUE_OPTIONS = [
  'repo-root',
  'output-dir',
  'source-sha',
  'release-id',
  'built-at',
  'repository',
  'workflow-name',
  'workflow-path',
  'event',
  'ref',
  'head-sha',
  'run-id',
  'run-attempt',
  'run-number',
  'actor',
  'artifact-name',
];

const fromArgumentOrEnvironment = (argumentsMap, argumentName, environmentName, fallback) =>
  argumentsMap[argumentName] ?? process.env[environmentName] ?? fallback;

const main = () => {
  const { values: args } = parseStrictCliArguments(process.argv.slice(2), { valueOptions: VALUE_OPTIONS });
  const repoRoot = path.resolve(fromArgumentOrEnvironment(args, 'repo-root', 'RELEASE_REPO_ROOT', process.cwd()));
  const configuredOutputDir = fromArgumentOrEnvironment(args, 'output-dir', 'RELEASE_OUTPUT_DIR');
  if (!configuredOutputDir) throw new Error('--output-dir or RELEASE_OUTPUT_DIR is required');
  const outputDir = path.resolve(configuredOutputDir);
  const sourceSha = fromArgumentOrEnvironment(args, 'source-sha', 'GITHUB_SHA');
  const runId = fromArgumentOrEnvironment(args, 'run-id', 'GITHUB_RUN_ID');
  const runAttempt = fromArgumentOrEnvironment(args, 'run-attempt', 'GITHUB_RUN_ATTEMPT');
  const releaseId = fromArgumentOrEnvironment(
    args,
    'release-id',
    'RELEASE_ID',
    sourceSha && runId && runAttempt
      ? `omnilodge-r${runId}-a${runAttempt}-${String(sourceSha).toLowerCase().slice(0, 12)}`
      : undefined,
  );
  const result = packageRelease({
    repoRoot,
    outputDir,
    metadata: {
      sourceSha,
      releaseId,
      builtAtUtc: fromArgumentOrEnvironment(args, 'built-at', 'RELEASE_BUILT_AT_UTC', new Date().toISOString()),
      workflow: {
        repository: fromArgumentOrEnvironment(args, 'repository', 'GITHUB_REPOSITORY'),
        workflowName: fromArgumentOrEnvironment(args, 'workflow-name', 'GITHUB_WORKFLOW'),
        workflowPath: fromArgumentOrEnvironment(args, 'workflow-path', 'RELEASE_WORKFLOW_PATH'),
        event: fromArgumentOrEnvironment(args, 'event', 'GITHUB_EVENT_NAME'),
        ref: fromArgumentOrEnvironment(args, 'ref', 'GITHUB_REF'),
        headSha: fromArgumentOrEnvironment(args, 'head-sha', 'GITHUB_SHA', sourceSha),
        runId,
        runAttempt,
        runNumber: fromArgumentOrEnvironment(args, 'run-number', 'GITHUB_RUN_NUMBER', null),
        actor: fromArgumentOrEnvironment(args, 'actor', 'GITHUB_ACTOR', null),
        artifactName: fromArgumentOrEnvironment(args, 'artifact-name', 'RELEASE_ARTIFACT_NAME', releaseId),
      },
    },
  });

  process.stdout.write(`${JSON.stringify({
    releaseId: result.manifest.releaseId,
    sourceSha: result.manifest.sourceSha,
    archivePath: result.archivePath,
    checksumPath: result.checksumPath,
    archiveSha256: result.archiveSha256,
    payloadFileCount: result.manifest.fileCount,
    productionCandidate: result.manifest.productionEligibility.candidate,
    productionIneligibilityReasons: result.manifest.productionEligibility.reasons,
  }, null, 2)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`Release packaging failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
