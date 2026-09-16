#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { extractVerifiedReleaseArchive, parseStrictCliArguments } from './lib.mjs';

const VALUE_OPTIONS = [
  'archive',
  'checksum',
  'expected-archive-sha256',
  'releases-directory',
  'workflow-conclusion',
  'artifact-id',
  'artifact-digest',
  'expected-release-id',
  'expected-source-sha',
  'expected-repository',
  'expected-workflow-path',
  'expected-event',
  'expected-ref',
  'expected-run-id',
  'expected-run-attempt',
  'expected-artifact-name',
];

const main = () => {
  const { values } = parseStrictCliArguments(process.argv.slice(2), {
    valueOptions: VALUE_OPTIONS,
  });
  if (!values.archive) throw new Error('--archive is required');
  if (!values['expected-archive-sha256']) {
    throw new Error('--expected-archive-sha256 is required');
  }
  if (!values['releases-directory']) throw new Error('--releases-directory is required');
  const archivePath = path.resolve(values.archive);
  const result = extractVerifiedReleaseArchive({
    archivePath,
    checksumPath: values.checksum ? path.resolve(values.checksum) : `${archivePath}.sha256`,
    expectedArchiveSha256: values['expected-archive-sha256'],
    releasesDirectory: path.resolve(values['releases-directory']),
    requireProductionEligible: true,
    productionEvidence: {
      workflowConclusion: values['workflow-conclusion'],
      artifactId: values['artifact-id'],
      artifactDigest: values['artifact-digest'],
      expectedReleaseId: values['expected-release-id'],
      expectedSourceSha: values['expected-source-sha'],
      expectedRepository: values['expected-repository'],
      expectedWorkflowPath: values['expected-workflow-path'],
      expectedEvent: values['expected-event'],
      expectedRef: values['expected-ref'],
      expectedRunId: values['expected-run-id'],
      expectedRunAttempt: values['expected-run-attempt'],
      expectedArtifactName: values['expected-artifact-name'],
    },
  });

  process.stdout.write(`${JSON.stringify({
    extracted: true,
    releaseId: result.manifest.releaseId,
    sourceSha: result.manifest.sourceSha,
    archiveSha256: result.archiveSha256,
    payloadFileCount: result.payloadFileCount,
    destinationPath: result.destinationPath,
    productionEligibilityVerified: true,
    warnings: result.warnings,
  }, null, 2)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`Release extraction failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
