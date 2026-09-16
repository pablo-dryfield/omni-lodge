import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const backendRoot = path.join(repositoryRoot, 'be');
const backendRequire = createRequire(path.join(backendRoot, 'package.json'));
const { Client } = backendRequire('pg');

const requiredEnvironment = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnvironment = requiredEnvironment.filter((name) => !(process.env[name] ?? '').trim());
if (missingEnvironment.length > 0) {
  throw new Error(`Missing disposable database configuration: ${missingEnvironment.join(', ')}`);
}

const databaseName = process.env.DB_NAME.trim();
const authorizedProbeDatabase = (process.env.MIGRATION_AUTHORITY_TEST_DATABASE ?? '').trim();
if (!authorizedProbeDatabase || authorizedProbeDatabase !== databaseName) {
  throw new Error(
    'Migration authority verification requires MIGRATION_AUTHORITY_TEST_DATABASE '
    + 'to exactly match DB_NAME for the disposable database.',
  );
}

const probeTable = `migration_authority_probe_${randomUUID().replaceAll('-', '')}`;
const quotedProbeTable = `"${probeTable}"`;
const controlTables = ['sequelize_meta', 'migration_audit_runs', 'migration_audit_steps'];
const metadataTable = 'sequelize_meta';
const orphanAuditTable = 'migration_audit_runs';
const runnerPath = path.join(backendRoot, 'dist', 'scripts', 'runMigrations.js');
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: databaseName,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const listApplicationTables = async () => {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> ALL($1::text[])
      ORDER BY table_name;
    `,
    [controlTables],
  );
  return result.rows.map((row) => row.table_name);
};

const listControlTables = async () => {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[])
      ORDER BY table_name;
    `,
    [controlTables],
  );
  return result.rows.map((row) => row.table_name);
};

const listAppliedMigrations = async () => {
  const result = await client.query('SELECT name FROM sequelize_meta ORDER BY name;');
  return result.rows.map((row) => row.name);
};

const assertExactList = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} changed unexpectedly: ${actual.join(', ')}`);
  }
};

const runRejectedMigration = (label, expectedMessage) => {
  const result = spawnSync(
    process.execPath,
    ['--enable-source-maps', runnerPath],
    {
      cwd: backendRoot,
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`Migration runner accepted ${label}`);
  }
  const runnerOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (!runnerOutput.includes(expectedMessage)) {
    throw new Error(
      `Migration runner rejected ${label} for an unexpected reason: ${runnerOutput.slice(0, 2_000)}`,
    );
  }
};

let primaryError;
let probeCreated = false;
let metadataCreated = false;
let orphanAuditCreated = false;
try {
  await client.connect();
  const initialTables = await listApplicationTables();
  if (initialTables.length !== 0) {
    throw new Error(`Migration authority probe requires an empty database; found: ${initialTables.join(', ')}`);
  }
  const initialControlTables = await listControlTables();
  if (initialControlTables.length !== 0) {
    throw new Error(
      `Migration authority probe requires no existing control tables; found: ${initialControlTables.join(', ')}`,
    );
  }

  await client.query(`CREATE TABLE "${orphanAuditTable}" (id integer PRIMARY KEY);`);
  orphanAuditCreated = true;
  runRejectedMigration(
    'orphaned audit control state',
    'Migration control state is inconsistent',
  );
  assertExactList(await listApplicationTables(), [], 'Orphan-control application tables');
  assertExactList(
    await listControlTables(),
    [orphanAuditTable],
    'Orphan-control control tables',
  );
  await client.query(`DROP TABLE "${orphanAuditTable}";`);
  orphanAuditCreated = false;

  await client.query(`CREATE TABLE ${quotedProbeTable} (id integer PRIMARY KEY);`);
  probeCreated = true;
  runRejectedMigration(
    'an unmanaged existing schema',
    'Migration authority is missing',
  );
  assertExactList(await listControlTables(), [], 'Unmanaged-schema control tables');
  assertExactList(await listApplicationTables(), [probeTable], 'Unmanaged-schema application tables');

  await client.query('CREATE TABLE sequelize_meta (name VARCHAR(255) PRIMARY KEY);');
  metadataCreated = true;
  const unknownMigration = '209912310001-unknown-authority-probe.js';
  await client.query('INSERT INTO sequelize_meta (name) VALUES ($1);', [unknownMigration]);
  runRejectedMigration(
    'metadata containing an unknown migration',
    'Migration metadata lineage is invalid',
  );
  assertExactList(await listControlTables(), [metadataTable], 'Unknown-lineage control tables');
  assertExactList(await listApplicationTables(), [probeTable], 'Unknown-lineage application tables');
  assertExactList(await listAppliedMigrations(), [unknownMigration], 'Unknown-lineage metadata');

  const compiledMigrationNames = readdirSync(path.join(backendRoot, 'dist', 'migrations'))
    .filter((name) => name.endsWith('.js'))
    .sort();
  if (compiledMigrationNames.length < 3) {
    throw new Error('Migration authority probe requires at least three compiled migrations');
  }
  const nonContiguousMigrations = [compiledMigrationNames[0], compiledMigrationNames[2]].sort();
  await client.query('TRUNCATE TABLE sequelize_meta;');
  await client.query(
    'INSERT INTO sequelize_meta (name) SELECT name FROM unnest($1::text[]) AS name;',
    [nonContiguousMigrations],
  );
  runRejectedMigration(
    'non-contiguous migration metadata',
    'Migration metadata lineage is invalid',
  );
  assertExactList(await listControlTables(), [metadataTable], 'Non-contiguous-lineage control tables');
  assertExactList(await listApplicationTables(), [probeTable], 'Non-contiguous-lineage application tables');
  assertExactList(
    await listAppliedMigrations(),
    nonContiguousMigrations,
    'Non-contiguous-lineage metadata',
  );

  process.stdout.write(`${JSON.stringify({
    status: 'valid',
    rejectedClassifications: [
      'unexpected_control_state',
      'unmanaged_existing_schema',
      'unknown_metadata_lineage',
      'non_contiguous_metadata_lineage',
    ],
    controlTablesCreated: 0,
  })}\n`);
} catch (error) {
  primaryError = error;
} finally {
  if (metadataCreated) {
    try {
      await client.query('DROP TABLE IF EXISTS sequelize_meta;');
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }
  if (orphanAuditCreated) {
    try {
      await client.query(`DROP TABLE IF EXISTS "${orphanAuditTable}";`);
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }
  if (probeCreated) {
    try {
      await client.query(`DROP TABLE IF EXISTS ${quotedProbeTable};`);
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }
  await client.end().catch(() => undefined);
}

if (primaryError) throw primaryError;
