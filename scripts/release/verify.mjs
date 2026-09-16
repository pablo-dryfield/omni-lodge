#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { parseStrictCliArguments, verifyReleaseArchive } from './lib.mjs';

const VALUE_OPTIONS = [
  'archive',
  'checksum',
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
  const { values, flags } = parseStrictCliArguments(process.argv.slice(2), {
    valueOptions: VALUE_OPTIONS,
    booleanOptions: ['require-production-eligible'],
  });
  if (!values.archive) throw new Error('--archive is required');
  const archivePath = path.resolve(values.archive);
  const requireProductionEligible = flags.has('require-production-eligible');
  const productionOnlyOptions = VALUE_OPTIONS.filter((option) => option !== 'archive' && option !== 'checksum');
  if (!requireProductionEligible && productionOnlyOptions.some((option) => values[option] !== undefined)) {
    throw new Error('Production evidence options require --require-production-eligible');
  }
  const result = verifyReleaseArchive({
    archivePath,
    checksumPath: values.checksum ? path.resolve(values.checksum) : `${archivePath}.sha256`,
    requireProductionEligible,
    productionEvidence: requireProductionEligible
      ? {
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
        }
      : null,
  });

  process.stdout.write(`${JSON.stringify({
    verified: true,
    releaseId: result.manifest.releaseId,
    sourceSha: result.manifest.sourceSha,
    archiveSha256: result.archiveSha256,
    payloadFileCount: result.payloadFileCount,
    productionCandidate: result.productionCandidate,
    productionEligibilityVerified: requireProductionEligible,
  }, null, 2)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`Release verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
