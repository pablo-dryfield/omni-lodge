import { readFileSync } from 'node:fs';
import path from 'node:path';

type BackendPackage = {
  scripts?: Record<string, string>;
};

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as BackendPackage;
const scripts = packageJson.scripts ?? {};

const compilationMarkers = [
  /(?:^|\s|&&)tsc(?:\s|$|&&)/u,
  /(?:^|\s|&&)tsx(?:\s|$|&&)/u,
  /npm\s+run\s+build(?::[\w:-]+)?(?:\s|$|&&)/u,
  /build:clean/u,
  /(?:^|\s)rimraf(?:\s|$)/u,
  /rm\s+-rf/u,
];

const expectRuntimeOnly = (name: string, compiledEntryPoint: string) => {
  const command = scripts[name];
  expect(command).toEqual(expect.any(String));
  expect(command).toContain(compiledEntryPoint);
  compilationMarkers.forEach((marker) => expect(command).not.toMatch(marker));
};

describe('backend build and runtime package scripts', () => {
  it('does not compile application code during dependency installation', () => {
    expect(scripts.postinstall).toBeUndefined();
  });

  it('keeps the production build limited to compilation and compiled-output verification', () => {
    expect(scripts['build:prod']).toContain('tsc');
    expect(scripts['build:prod']).toContain('verify:compiled-monitoring-models');
    expect(scripts['build:prod']).not.toMatch(/dist\/app\.js|runMigrations|syncAccessControl/u);
  });

  it('starts an already-built backend through the monitored launcher without compiling', () => {
    expectRuntimeOnly('start:runtime', 'scripts/startMonitored.js dist/app.js');
    expect(scripts['start:runtime']).toContain('NODE_ENV=production');
    expect(scripts['start:runtime']).toContain('--enable-source-maps');
  });

  it('runs compiled migrations without compiling', () => {
    expectRuntimeOnly('migrate:runtime', 'dist/scripts/runMigrations.js');
    expect(scripts['migrate:runtime']).toContain('NODE_ENV=production');
    expect(scripts['migrate:runtime']).toContain('SEED_ACCESS_CONTROL=false');
    expect(scripts['migrate:runtime']).not.toContain('SEED_ACCESS_CONTROL=true');
    expect(scripts['migrate:prod']).toContain('SEED_ACCESS_CONTROL=false');
  });

  it('reports migration status from compiled code without compiling or running migrations', () => {
    expectRuntimeOnly('migrate:status:runtime', 'dist/scripts/reportMigrationStatus.js');
    expect(scripts['migrate:status:runtime']).toContain('NODE_ENV=production');
    expect(scripts['migrate:status:runtime']).not.toContain('runMigrations.js');
  });

  it('runs the dedicated compiled backend preflight without starting the application', () => {
    expectRuntimeOnly('preflight:runtime', 'dist/scripts/runtimePreflight.js');
    expect(scripts['preflight:runtime']).toContain('NODE_ENV=production');
    expect(scripts['preflight:runtime']).not.toContain('dist/app.js');
  });

  it('runs the compiled access-control sync without compiling', () => {
    expectRuntimeOnly('sync-access-control:runtime', 'dist/scripts/syncAccessControl.js');
    expect(scripts['sync-access-control:runtime']).toContain('NODE_ENV=production');
  });

  it.each([
    ['start:prod', 'start:runtime'],
    ['migrate:prod', 'migrate:runtime'],
    ['sync:access-control:prod', 'sync-access-control:runtime'],
  ])('keeps legacy %s safe as a build-then-%s transition wrapper', (legacyName, runtimeName) => {
    const command = scripts[legacyName];
    expect(command).toEqual(expect.any(String));
    expect(command).toContain('npm run build:prod');
    expect(command).toContain(`npm run ${runtimeName}`);
    expect(command.indexOf('npm run build:prod')).toBeLessThan(command.indexOf(`npm run ${runtimeName}`));
  });
});
