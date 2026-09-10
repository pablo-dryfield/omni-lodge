import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modelPaths = [
  'dist/models/ErrorMonitoringIssue.js',
  'dist/models/ErrorMonitoringOccurrence.js',
  'dist/models/ErrorMonitoringNote.js',
];

for (const modelPath of modelPaths) {
  const modelUrl = pathToFileURL(path.resolve(process.cwd(), modelPath)).href;
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(modelUrl)})`],
    { env: process.env, stdio: 'pipe' },
  );
}

console.log('Compiled error-monitoring model imports verified.');
