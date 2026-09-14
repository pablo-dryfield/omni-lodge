#!/usr/bin/env node

import process from 'node:process';
import { parseStrictCliArguments, preflightPayloadTree } from './lib.mjs';

const main = () => {
  const { values } = parseStrictCliArguments(process.argv.slice(2), {
    valueOptions: ['path'],
  });
  if (!values.path) throw new Error('--path is required');
  const result = preflightPayloadTree({
    repoRoot: process.cwd(),
    relativePath: values.path,
  });
  process.stdout.write(`${JSON.stringify({ preflightPassed: true, ...result }, null, 2)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`Release preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
