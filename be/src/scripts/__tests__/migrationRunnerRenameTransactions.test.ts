import { readFileSync } from 'node:fs';
import path from 'node:path';

const runnerSource = readFileSync(
  path.resolve(process.cwd(), 'src', 'scripts', 'runMigrations.ts'),
  'utf8',
);

const wrapperSource = (operation: 'renameTable' | 'renameColumn'): string => {
  const start = runnerSource.indexOf(`if (prop === '${operation}')`);
  const end = runnerSource.indexOf("if (prop === '", start + 1);
  if (start < 0 || end < 0) throw new Error(`Unable to locate ${operation} wrapper`);
  return runnerSource.slice(start, end);
};

describe('migration runner rename transaction forwarding', () => {
  it.each(['renameTable', 'renameColumn'] as const)(
    'forwards the transaction options through the %s idempotency wrapper',
    (operation) => {
      const source = wrapperSource(operation);

      expect(source).toMatch(/options\?: unknown/u);
      expect(source).toContain('const transaction = getTransaction(options);');
      expect(source).toMatch(/Exists\([^)]*transaction\)/u);
      expect(source).toMatch(/\.call\(target,[\s\S]*options\);/u);
    },
  );
});
