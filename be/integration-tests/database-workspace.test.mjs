import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import net from 'node:net';
import { assertRestrictedIdentity } from '../src/services/databaseWorkspace/connection.ts';
import dotenv from 'dotenv';
import { parseSql } from '../src/services/databaseWorkspace/parser.ts';
import {
  compareDecimal,
  validateFilter,
  compileFilter,
  quoteIdentifier,
} from '../src/services/databaseWorkspace/filters.ts';
import {
  WorkspaceStore,
  operationHash,
} from '../src/services/databaseWorkspace/store.ts';
import { runJob } from '../src/services/databaseWorkspace/runner.ts';
import {
  readResult,
  cleanupArtifacts,
} from '../src/services/databaseWorkspace/artifacts.ts';
import {
  createReview,
  verifyReview,
} from '../src/services/databaseWorkspace/reviews.ts';
import {
  buildDataChanges,
  buildTableView,
  tableCursor,
} from '../src/services/databaseWorkspace/dataChanges.ts';
import {
  openSession,
  getSession,
  SessionEngine,
} from '../src/services/databaseWorkspace/sessions.ts';
import {
  parseImport,
  prepareImport,
} from '../src/services/databaseWorkspace/imports.ts';
import {
  parseDDL,
  prepareMaintenance,
} from '../src/services/databaseWorkspace/administration.ts';
import {
  validateSchedule,
  nextOccurrence,
} from '../src/services/databaseWorkspace/schedules.ts';
import {
  initializeRecovery,
  stageRecovery,
  runRecovery,
  runTool,
} from '../src/services/databaseWorkspace/recovery.ts';
import { pipeline } from 'node:stream/promises';
import {
  backupCopyFingerprint,
  deleteLocalBackup,
  validatedLocalBackup,
} from '../src/services/backupCopyStorage.ts';
import {
  schemaSnapshot,
  compareSchemas,
  dependencyOrder,
} from '../src/services/databaseWorkspace/schemaTools.ts';
import { activitySnapshot } from '../src/services/databaseWorkspace/monitoring.ts';
import { provisionWorkspaceRoles } from '../src/services/databaseWorkspace/provisioning.ts';
import { prepareRoleChange } from '../src/services/databaseWorkspace/privileges.ts';
import {
  systemdWorkerLaunch,
  linuxProcessStart,
  linuxWorkerLimits,
} from '../src/services/databaseWorkspace/workerLaunch.ts';

process.env.CONFIG_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const policy = {
  maxBytes: 102400,
  maxStatements: 20,
  mode: 'read',
  schemas: ['public'],
  protectedObjects: ['users'],
};
test('real PostgreSQL parser rejects nested writes and unsafe session/function paths', async () => {
  for (const sql of [
    'WITH q AS (DELETE FROM sample RETURNING *) SELECT * FROM q',
    'SELECT * INTO copied FROM sample',
    'EXPLAIN ANALYZE DELETE FROM sample',
    "SELECT set_config('statement_timeout','0',false)",
    'SELECT public.untrusted_function()',
    'SELECT * FROM users',
    'SET ROLE postgres',
    'BEGIN',
    "COPY sample TO PROGRAM 'whoami'",
  ]) {
    await assert.rejects(parseSql(sql, 17, policy), undefined, sql);
  }
  assert.equal(
    (
      await parseSql(
        "select E'a\\\';b' AS value; /* nested /* comment */ end */ select $$x;y$$",
        17,
        policy,
      )
    ).length,
    2,
  );
  assert.equal(
    (await parseSql("SELECT 'Kraków 😀' AS value; SELECT 2", 17, policy))[1]
      .sql,
    'SELECT 2',
  );
  await assert.rejects(parseSql(42, 17, policy), { code: 'INVALID_SQL' });
  await assert.rejects(parseSql('SELECT 1', 18, policy), {
    code: 'UNSUPPORTED_SERVER_VERSION',
  });
  await assert.rejects(parseSql('-- comment only', 17, policy), {
    code: 'STATEMENT_LIMIT',
  });
});
test('typed filters preserve decimals and parameterize hostile values', () => {
  assert.equal(compareDecimal('9007199254740993', '9007199254740992'), 1);
  assert.equal(compareDecimal('-0.01', '0'), -1);
  assert.equal(compareDecimal('1.200', '12e-1'), 0);
  const filter = validateFilter(
    {
      group: 'and',
      children: [
        { column: 'name', operator: 'contains', value: "%' OR true--" },
        { column: 'name', operator: 'notNull' },
      ],
    },
    new Set(['name']),
  );
  const values = [];
  const sql = compileFilter(
    filter,
    new Map([['name', 'Customer name']]),
    values,
  );
  assert.equal(sql.includes('OR true'), false);
  assert.equal(values.length, 1);
  assert.equal(sql.includes('$1'), true);
  assert.throws(() =>
    validateFilter(
      { column: 'bad', operator: 'eq', value: '1' },
      new Set(['name']),
    ),
  );
});
test('import parsing preserves quoted CSV, SQL null and exact JSON values', async () => {
  const options = { maxBytes: 10000, maxRows: 10, nullToken: '\\N' };
  const data = await parseImport(
    'id,note\r\n9007199254740993,"a,b\nnext"\r\n2,\\N',
    'csv',
    options,
  );
  assert.deepEqual(data.rows, [
    ['9007199254740993', 'a,b\nnext'],
    ['2', null],
  ]);
  await assert.rejects(parseImport('a,a\n1,2', 'csv', options), {
    code: 'IMPORT_HEADERS',
  });
  await assert.rejects(
    parseImport('[{"id":9007199254740993}]', 'json', options),
    { code: 'IMPORT_VALUES' },
  );
  assert.deepEqual(
    (
      await parseImport(
        '[{"id":"9007199254740993","note":null}]',
        'json',
        options,
      )
    ).rows,
    [['9007199254740993', null]],
  );
});
test('backup copy identity distinguishes locations and server deletion rejects traversal or changed files', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'omnilodge-backup-copy-'),
  );
  try {
    const filename = 'fixture.backup',
      fullPath = path.join(directory, filename);
    fs.writeFileSync(fullPath, 'fixture');
    const stat = fs.statSync(fullPath);
    const copy = {
      id: `local:${filename}`,
      filename,
      location: 'local',
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
    assert.notEqual(
      backupCopyFingerprint(copy),
      backupCopyFingerprint({
        ...copy,
        id: 'drive:fixture',
        location: 'drive',
      }),
    );
    await assert.rejects(validatedLocalBackup(directory, '../fixture.backup'));
    await assert.rejects(
      deleteLocalBackup(directory, { ...copy, sizeBytes: 99 }),
    );
    assert.equal(fs.existsSync(fullPath), true);
    await deleteLocalBackup(directory, copy);
    assert.equal(fs.existsSync(fullPath), false);
  } finally {
    assert.ok(directory.startsWith(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('review tokens bind the exact operation and actor', () => {
  const r = createReview('hash', 7, 60);
  assert.equal(typeof verifyReview(r.token, 'hash', 7), 'string');
  assert.throws(() => verifyReview(r.token, 'changed', 7));
  assert.throws(() => verifyReview(r.token, 'hash', 8));
  const expired = createReview('hash', 7, -1);
  assert.throws(() => verifyReview(expired.token, 'hash', 7));
});
test('production worker launch has independent resource caps and never places credentials in arguments', () => {
  const input = {
    pid: 42,
    parentStart: '900',
    unit: 'omnilodge-workspace-42-aabbccdd',
    script:
      '/opt/omnilodge/releases/test/be/dist/scripts/databaseWorkspaceWorker.js',
    cwd: '/opt/omnilodge/releases/test/be',
    artifactDirectory: '/var/lib/omnilodge/database-workspace',
    memoryMb: 768,
    cpuPercent: 100,
  };
  const launch = systemdWorkerLaunch(input);
  assert.equal(launch.executable, '/usr/bin/systemd-run');
  assert.ok(launch.args.includes('--property=MemoryMax=805306368'));
  assert.ok(
    launch.args.includes(
      '--property=EnvironmentFile=/etc/omnilodge/backend.env',
    ),
  );
  assert.equal(
    launch.args.some((a) => /password=|token=|secret=/i.test(a)),
    false,
  );
  assert.throws(() =>
    systemdWorkerLaunch({
      ...input,
      artifactDirectory: '/opt/omnilodge/releases/test/be/runtime',
    }),
  );
  assert.throws(() => systemdWorkerLaunch({ ...input, cpuPercent: 0 }));
  const stat =
    '42 (worker (safe)) S ' +
    Array.from({ length: 18 }, () => '0').join(' ') +
    ' 900 0';
  assert.equal(linuxProcessStart(stat), '900');
  const limits = linuxWorkerLimits('0::/system.slice/test.service', (file) =>
    file.endsWith('memory.max')
      ? '805306368'
      : file.endsWith('cpu.max')
        ? '100000 100000'
        : '64',
  );
  assert.deepEqual(limits, {
    memoryBytes: 805306368,
    cpuPercent: 100,
    tasks: 64,
  });
  assert.throws(() => linuxWorkerLimits('0::/test', () => 'max'));
});
test('daily schedules skip DST gaps and never repeat the second folded local time', () => {
  const spec = validateSchedule({
    timezone: 'Europe/Warsaw',
    time: '02:30',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    missed: 'skip',
    overlap: 'skip',
    dst: 'skip-gap-once-fold',
  });
  assert.equal(
    nextOccurrence(new Date('2026-03-28T03:00:00Z'), spec).toISOString(),
    '2026-03-30T00:30:00.000Z',
  );
  assert.equal(
    nextOccurrence(new Date('2026-10-24T23:00:00Z'), spec).toISOString(),
    '2026-10-25T00:30:00.000Z',
  );
  assert.equal(
    nextOccurrence(new Date('2026-10-25T00:45:00Z'), spec).toISOString(),
    '2026-10-26T01:30:00.000Z',
  );
  assert.throws(() => validateSchedule({ ...spec, timezone: 'not/a-zone' }), {
    code: 'SCHEDULE_TIMEZONE',
  });
});
test('schema parser isolates nontransactional work and rejects protected administration', async () => {
  const target = { major: 17, schemas: ['public'] };
  for (const sql of [
    'DROP TABLE public.users',
    'DROP TABLE outside.tab',
    "CREATE TYPE outside.state AS ENUM ('ok')",
    'ALTER TABLE public.sample OWNER TO postgres',
    'DROP TABLE public.sample CASCADE',
    'DO $$ BEGIN NULL; END $$',
    'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$',
  ])
    await assert.rejects(
      parseDDL(sql, target, 102400, 20, ['users']),
      undefined,
      sql,
    );
  const concurrent = await parseDDL(
    'CREATE INDEX CONCURRENTLY sample_note ON public.sample(note)',
    target,
    102400,
    20,
    [],
  );
  assert.equal(concurrent.atomic, false);
  await assert.rejects(
    parseDDL(
      'CREATE INDEX CONCURRENTLY sample_note ON public.sample(note); CREATE TABLE public.second(id int)',
      target,
      102400,
      20,
      [],
    ),
    { code: 'NONATOMIC_BATCH' },
  );
  assert.equal(
    (
      await parseDDL(
        'CREATE TABLE public.checkpoint(id int PRIMARY KEY)',
        target,
        102400,
        20,
        [],
      )
    ).atomic,
    true,
  );
});

const supplied = process.env.WORKSPACE_TEST_ADMIN_URL;
const local = fs.existsSync('.env.dev')
  ? dotenv.parse(fs.readFileSync('.env.dev'))
  : {};
const available = Boolean(supplied || local.DB_HOST);
const suffix = crypto.randomBytes(6).toString('hex');
const controlName = `omni_dw_test_${suffix}_control`,
  dataName = `omni_dw_test_${suffix}_data`;
const readName = `dw_test_${suffix}_read`,
  writeName = `dw_test_${suffix}_write`;
const restoreName = `dw_test_${suffix}_restore`,
  restoreDatabase = `omnilodge_restore_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${suffix.slice(0, 8)}`;
const password = crypto.randomBytes(24).toString('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-dw-test-'));
let admin, store, target, config;
const connectConfig = supplied
  ? { connectionString: supplied }
  : {
      host: local.DB_HOST,
      port: Number(local.DB_PORT || 5432),
      database: local.DB_NAME,
      user: local.DB_USER,
      password: local.DB_PASSWORD,
    };
before(async () => {
  if (!available) return;
  const host = supplied ? new URL(supplied).hostname : local.DB_HOST;
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(host),
    'Integration fixture refuses non-loopback admin connections',
  );
  admin = new pg.Client(connectConfig);
  await admin.connect();
  const major = Number(
    (
      await admin.query(
        "SELECT current_setting('server_version_num')::int/10000 AS major",
      )
    ).rows[0].major,
  );
  await admin.query(
    `CREATE ROLE ${quoteIdentifier(readName)} LOGIN PASSWORD '${password}'`,
  );
  await admin.query(
    `CREATE ROLE ${quoteIdentifier(writeName)} LOGIN PASSWORD '${password}'`,
  );
  await admin.query(
    `CREATE ROLE ${quoteIdentifier(restoreName)} LOGIN CREATEDB PASSWORD '${password}'`,
  );
  await admin.query(`CREATE DATABASE ${quoteIdentifier(controlName)}`);
  await admin.query(`CREATE DATABASE ${quoteIdentifier(dataName)}`);
  const base = supplied ? new URL(supplied) : new URL('postgresql://localhost');
  if (!supplied) {
    base.hostname = local.DB_HOST;
    base.port = local.DB_PORT || '5432';
    base.username = local.DB_USER;
    base.password = local.DB_PASSWORD;
  }
  base.pathname = controlName;
  store = new WorkspaceStore(base.toString());
  await store.initialize();
  await initializeRecovery(store);
  const setup = new pg.Client({
    ...connectConfig,
    connectionString: undefined,
    database: dataName,
    host: base.hostname,
    port: Number(base.port || 5432),
    user: decodeURIComponent(base.username),
    password: decodeURIComponent(base.password),
  });
  await setup.connect();
  await setup.query(`CREATE TABLE public.sample(id integer PRIMARY KEY,amount numeric,document jsonb,note text);
    INSERT INTO public.sample VALUES(1,1.20,'null','original');
    GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(readName)},${quoteIdentifier(writeName)};
    GRANT SELECT ON public.sample TO ${quoteIdentifier(readName)};
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.sample TO ${quoteIdentifier(writeName)};`);
  await setup.end();
  target = {
    id: 'test',
    label: 'Test',
    environment: 'test',
    host: base.hostname,
    port: Number(base.port || 5432),
    database: dataName,
    major,
    schemas: ['public'],
    tls: false,
  };
  config = {
    queryMaxBytes: 102400,
    batchMaxStatements: 20,
    readTimeoutMs: 5000,
    writeTimeoutMs: 5000,
    lockTimeoutMs: 500,
    jobMaxDurationMs: 10000,
    activeJobsPerUser: 1,
    activeJobsPerTarget: 2,
    activeWritesPerTarget: 1,
    queueMaxJobs: 50,
    queueWaitMs: 60000,
    resultPageRows: 200,
    resultMaxRows: 500,
    resultMaxBytes: 1048576,
    resultTtlMinutes: 60,
    writeMaxRows: 5,
    reviewTokenTtlSeconds: 60,
    artifactDirectory: root,
    storageBudgetBytes: 16777216,
  };
});
after(async () => {
  await store?.close();
  if (admin) {
    for (const database of [controlName, dataName, restoreDatabase]) {
      assert.ok(
        database === restoreDatabase
          ? /^omnilodge_restore_\d{8}_[a-f0-9]{8}$/.test(database)
          : /^omni_dw_test_[a-f0-9]+_(control|data)$/.test(database),
      );
      await admin.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`,
      );
    }
    for (const role of [readName, writeName, restoreName])
      await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`);
    await admin.end();
  }
  assert.ok(root.startsWith(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
});
async function enqueue(sql, mode = 'read', actorId = 1, overrides = {}) {
  const statements = await parseSql(sql, target.major, { ...policy, mode });
  const payload = {
    actorId,
    target,
    credential: { user: mode === 'read' ? readName : writeName, password },
    statements,
    parameters: [],
    mode,
    reason: 'integration test',
    limits: { ...config, ...overrides },
    policyHash: 'test',
    protectedObjects: ['users'],
  };
  const job = await store.enqueue(
    payload,
    operationHash({ sql, mode }),
    crypto.randomUUID(),
  );
  const claimed = await store.claim('test-worker');
  assert.equal(claimed.job.id, job.id);
  return { job: claimed.job, payload: claimed.payload };
}
async function run(sql, mode = 'read', overrides = {}) {
  const j = await enqueue(sql, mode, 1, overrides);
  await runJob(store, j.job, j.payload, async () => {});
  return store.get(j.job.id, 1);
}
const integration = { skip: !available };
test(
  'actual write plans enforce RETURNING budgets and always roll back',
  integration,
  async () => {
    await assert.rejects(
      parseSql(
        'EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM sample',
        target.major,
        { ...policy, mode: 'write' },
      ),
      { code: 'PLAN_RETURNING_REQUIRED' },
    );
    const original = await run('SELECT note FROM sample WHERE id=1');
    const before = (await readResult(store, original.id, 0, 1)).rows[0][0];
    const plan = await run(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) UPDATE sample SET note='plan diagnostic' WHERE id=1 RETURNING id",
      'write',
    );
    assert.equal(plan.status, 'succeeded');
    assert.equal(plan.transactionOutcome, 'rolled_back');
    assert.equal(plan.outcomes[0].affectedRows, 1);
    const after = await run('SELECT note FROM sample WHERE id=1');
    assert.equal((await readResult(store, after.id, 0, 1)).rows[0][0], before);
    const limited = await run(
      'EXPLAIN (ANALYZE, FORMAT JSON) INSERT INTO sample(id) SELECT generate_series(100,106) RETURNING id',
      'write',
    );
    assert.equal(limited.status, 'failed');
    assert.equal(limited.transactionOutcome, 'rolled_back');
    assert.equal(limited.error.code, 'WRITE_ROW_LIMIT');
    await assert.rejects(
      parseSql(
        'EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM sample RETURNING 1; SELECT 1',
        target.major,
        { ...policy, mode: 'write' },
      ),
      { code: 'PLAN_SINGLE_STATEMENT' },
    );
  },
);
test('schema dependency ordering exposes cycles instead of emitting a plausible unsafe order', () => {
  const o = (key, dependencies = []) => ({
    key,
    dependencies,
    family: 'relation',
    schema: 'public',
    name: key,
    definition: key,
    oid: key,
    details: {},
  });
  assert.deepEqual(
    dependencyOrder([
      o('view', ['table']),
      o('table', ['enum']),
      o('enum'),
    ]).objects.map((x) => x.key),
    ['enum', 'table', 'view'],
  );
  assert.deepEqual(
    dependencyOrder([o('a', ['b']), o('b', ['a']), o('c', ['b'])]).cycles,
    ['a', 'b', 'c'],
  );
});
test(
  'import validation reports exact row conversion errors without inserting data',
  integration,
  async () => {
    const object = await run(
      "SELECT oid::text FROM pg_class WHERE relname='sample'",
    );
    const objectId = (await readResult(store, object.id, 0, 1)).rows[0][0];
    const data = {
      headers: ['id', 'amount', 'note'],
      rows: [
        ['25', 'not a number', 'imported'],
        ['26', '2.50', 'second'],
      ],
    };
    const options = {
      objectId,
      mapping: { id: 'id', amount: 'amount', note: 'note' },
      duplicatePolicy: 'insert',
    };
    const invalid = await prepareImport(
      target,
      { user: writeName, password },
      [],
      config,
      data,
      options,
    );
    assert.equal(invalid.errors[0].row, 1);
    assert.equal(invalid.errors[0].column, 'amount');
    const valid = await prepareImport(
      target,
      { user: writeName, password },
      [],
      config,
      { ...data, rows: [['25', '2.50', 'imported']] },
      options,
    );
    assert.equal(valid.errors.length, 0);
    const check = await run('SELECT count(*) FROM sample WHERE id=25');
    assert.equal((await readResult(store, check.id, 0, 1)).rows[0][0], '0');
    const payload = {
      actorId: 1,
      target,
      credential: { user: writeName, password },
      statements: valid.statements,
      parameters: [],
      mode: 'write',
      reason: 'import test',
      limits: config,
      policyHash: 'test',
      protectedObjects: [],
      schemaChecks: valid.schemaChecks,
    };
    const created = await store.enqueue(payload, operationHash(valid));
    const claimed = await store.claim('test-worker');
    assert.equal(created.id, claimed.job.id);
    await runJob(store, claimed.job, payload, async () => {});
    assert.equal(
      (await store.get(created.id, 1)).transactionOutcome,
      'committed',
    );
    await run('DELETE FROM sample WHERE id=25', 'write');
  },
);
test(
  'expert sessions preserve savepoints, recover aborted commands, and commit explicitly',
  integration,
  async () => {
    const payload = {
      actorId: 1,
      target,
      credential: { user: writeName, password },
      statements: [],
      parameters: [],
      mode: 'write',
      reason: 'session test',
      limits: config,
      policyHash: 'test',
      protectedObjects: [],
      sessionPolicy: {
        idleMs: 10000,
        transactionMaxMs: 30000,
        maxMs: 60000,
        maxPerTarget: 1,
      },
    };
    const session = await openSession(store, payload),
      engine = new SessionEngine(store, 'session-test', async () => {});
    await engine.tick();
    const command = async (kind, sql = '', name) => {
      const current = (await getSession(store, session.id, 1)).record;
      const statements = sql
        ? await parseSql(sql, 17, { ...policy, mode: 'write' })
        : [];
      const job = await store.enqueue(
        { ...payload, statements, sessionCommand: { command: kind, name } },
        crypto.randomUUID(),
        crypto.randomUUID(),
        undefined,
        { id: session.id, revision: current.revision },
      );
      for (let n = 0; n < 100; n++) {
        await engine.tick();
        await new Promise((r) => setTimeout(r, 15));
        const live = await store.get(job.id, 1);
        if (!['queued', 'running', 'cancel_requested'].includes(live.status))
          return live;
      }
      assert.fail('Session command did not complete');
    };
    try {
      assert.equal(
        (await command('savepoint', '', 'before_edit')).status,
        'succeeded',
      );
      assert.equal(
        (
          await command(
            'sql',
            "UPDATE sample SET note='session tentative' WHERE id=1",
          )
        ).transactionOutcome,
        'staged',
      );
      const failed = await command('sql', 'INSERT INTO sample(id) VALUES(1)');
      assert.equal(failed.status, 'failed');
      assert.equal(
        (await getSession(store, session.id, 1)).record.state,
        'aborted',
      );
      assert.equal(
        (await command('rollbackTo', '', 'before_edit')).status,
        'succeeded',
      );
      assert.equal(
        (
          await command(
            'sql',
            "UPDATE sample SET note='session committed' WHERE id=1",
          )
        ).status,
        'succeeded',
      );
      assert.equal((await command('commit')).transactionOutcome, 'committed');
      assert.equal(
        (await getSession(store, session.id, 1)).record.outcome,
        'committed',
      );
      const read = await run('SELECT note FROM sample WHERE id=1');
      assert.equal(
        (await readResult(store, read.id, 0, 1)).rows[0][0],
        'session committed',
      );
      await run("UPDATE sample SET note='original' WHERE id=1", 'write');
    } finally {
      await engine.shutdown();
    }
  },
);
test(
  'read jobs preserve duplicate/empty fields, bigint, exact JSON and SQL NULL',
  integration,
  async () => {
    const job = await run(
      `SELECT 9007199254740993::bigint AS id,42 AS id,NULL::jsonb AS sql_null,'null'::jsonb AS json_null,'{"value":9007199254740993}'::jsonb AS document,1.20::numeric AS amount`,
    );
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
    assert.equal(job.transactionOutcome, 'read_only');
    const r = await readResult(store, job.id, 0, 1);
    assert.equal(r.fields[0].name, r.fields[1].name);
    assert.notEqual(r.fields[0].id, r.fields[1].id);
    assert.deepEqual(r.rows[0].slice(0, 4), [
      '9007199254740993',
      '42',
      null,
      'null',
    ]);
    assert.ok(r.rows[0][4].includes('9007199254740993'));
    const empty = await run('SELECT id,amount FROM public.sample WHERE false');
    const er = await readResult(store, empty.id, 0, 1);
    assert.equal(er.fields.length, 2);
    assert.equal(er.rows.length, 0);
    await assert.rejects(readResult(store, job.id, 0, 2), {
      code: 'RESULT_EXPIRED',
    });
  },
);
test(
  'capturing a large read is bounded and result filters do not rerun SQL',
  integration,
  async () => {
    const job = await run('SELECT generate_series(1,100000) AS n');
    assert.equal(job.status, 'succeeded', JSON.stringify(job.error));
    const r = await readResult(store, job.id, 0, 1, {
      filter: { column: 'c0', operator: 'gt', value: '490' },
    });
    assert.equal(r.capturedRows, 500);
    assert.equal(r.complete, false);
    assert.equal(r.rows.length, 10);
    assert.equal(r.rows[0][0], '491');
  },
);
test(
  'a failed write batch rolls back earlier statements and exposes the failed index',
  integration,
  async () => {
    const job = await run(
      "UPDATE sample SET note='changed' WHERE id=1; INSERT INTO sample(id) VALUES(1)",
      'write',
    );
    assert.equal(job.status, 'failed');
    assert.equal(job.transactionOutcome, 'rolled_back');
    assert.equal(job.outcomes.length, 2);
    assert.equal(job.outcomes[1].error.sqlState, '23505');
    const read = await run('SELECT note FROM sample WHERE id=1');
    assert.equal(
      (await readResult(store, read.id, 0, 1)).rows[0][0],
      'original',
    );
  },
);
test(
  'row budget and revoked authority both roll back writes',
  integration,
  async () => {
    const job = await run(
      'INSERT INTO sample(id) SELECT generate_series(2,20)',
      'write',
    );
    assert.equal(job.transactionOutcome, 'rolled_back');
    assert.equal(job.error.code, 'WRITE_ROW_LIMIT');
    const j = await enqueue(
      "UPDATE sample SET note='not committed' WHERE id=1",
      'write',
    );
    let calls = 0;
    await runJob(store, j.job, j.payload, async () => {
      if (++calls === 2) throw new Error('revoked');
    });
    assert.equal(
      (await store.get(j.job.id, 1)).transactionOutcome,
      'rolled_back',
    );
  },
);
test(
  'idempotency conflicts, single-use reviews and ownership are enforced',
  integration,
  async () => {
    const statements = await parseSql('SELECT 1', 17, policy);
    const payload = {
      actorId: 4,
      target,
      credential: { user: readName, password },
      statements,
      parameters: [],
      mode: 'read',
      reason: 'test',
      limits: config,
      policyHash: 'test',
      protectedObjects: [],
    };
    const key = crypto.randomUUID(),
      nonce = crypto.randomUUID();
    const first = await store.enqueue(payload, 'same', key, nonce);
    assert.equal(
      (await store.enqueue(payload, 'same', key, nonce)).id,
      first.id,
    );
    await assert.rejects(store.enqueue(payload, 'different', key), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(
      store.enqueue(payload, 'same', crypto.randomUUID(), nonce),
      { code: 'REVIEW_ALREADY_USED' },
    );
    await assert.rejects(store.get(first.id, 99), {
      code: 'EXECUTION_NOT_FOUND',
    });
    await store.cancel(first.id, 4);
  },
);
test(
  'running query cancellation uses its exact database session and confirms rollback',
  integration,
  async () => {
    const j = await enqueue(
      'SELECT count(*) FROM generate_series(1,100000000)',
    );
    const running = runJob(store, j.job, j.payload, async () => {});
    for (let n = 0; n < 30; n++) {
      const q = await store.pool.query(
        'SELECT backend_pid FROM database_workspace.jobs WHERE id=$1',
        [j.job.id],
      );
      if (q.rows[0].backend_pid) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await store.cancel(j.job.id, 1);
    await running;
    const result = await store.get(j.job.id, 1);
    assert.equal(result.status, 'cancelled', JSON.stringify(result.error));
    assert.equal(result.transactionOutcome, 'rolled_back');
  },
);
test(
  'expired results release their reserved storage',
  integration,
  async () => {
    const job = await run('SELECT 1');
    await store.pool.query(
      "UPDATE database_workspace.artifacts SET expires_at=now()-interval '1 second' WHERE execution_id=$1",
      [job.id],
    );
    assert.ok((await cleanupArtifacts(store)) > 0);
    await assert.rejects(readResult(store, job.id, 0, 1), {
      code: 'RESULT_EXPIRED',
    });
  },
);
test(
  'structured editing rejects stale rows and commits only the reviewed exact row',
  integration,
  async () => {
    const oid = await run(
      "SELECT oid::text FROM pg_class WHERE relname='sample'",
    );
    const objectId = (await readResult(store, oid.id, 0, 1)).rows[0][0];
    const original = {
      id: '1',
      amount: '1.20',
      document: 'null',
      note: 'original',
    };
    const plan = await buildDataChanges(
      target,
      { user: writeName, password },
      [],
      config,
      {
        objectId,
        changes: [{ kind: 'update', original, values: { note: 'edited' } }],
      },
    );
    const payload = {
      actorId: 1,
      target,
      credential: { user: writeName, password },
      statements: plan.statements,
      parameters: [],
      mode: 'write',
      reason: 'structured test',
      limits: config,
      policyHash: 'test',
      protectedObjects: [],
      schemaChecks: plan.schemaChecks,
    };
    const created = await store.enqueue(payload, operationHash(plan));
    const claimed = await store.claim('test-worker');
    assert.equal(created.id, claimed.job.id);
    await runJob(store, claimed.job, payload, async () => {});
    assert.equal(
      (await store.get(created.id, 1)).transactionOutcome,
      'committed',
    );
    const stale = await store.enqueue(payload, operationHash(plan));
    const staleClaim = await store.claim('test-worker');
    assert.equal(stale.id, staleClaim.job.id);
    await runJob(store, staleClaim.job, payload, async () => {});
    const result = await store.get(stale.id, 1);
    assert.equal(result.transactionOutcome, 'rolled_back');
    assert.equal(result.error.code, 'ROW_CONFLICT');
  },
);
test(
  'table browsing uses a signed keyset cursor with a primary-key tie breaker',
  integration,
  async () => {
    const inserted = await run(
      "INSERT INTO sample(id,note) SELECT generate_series(2,6),'same'",
      'write',
    );
    assert.equal(inserted.transactionOutcome, 'committed');
    const oid = await run(
      "SELECT oid::text FROM pg_class WHERE relname='sample'",
    );
    const objectId = (await readResult(store, oid.id, 0, 1)).rows[0][0];
    const first = await buildTableView(
      target,
      { user: readName, password },
      [],
      config,
      { objectId, pageSize: 2 },
    );
    async function page(view) {
      const payload = {
        actorId: 1,
        target,
        credential: { user: readName, password },
        statements: view.statements,
        parameters: [],
        mode: 'read',
        reason: 'table page',
        limits: config,
        policyHash: 'test',
        protectedObjects: [],
      };
      const created = await store.enqueue(payload, operationHash(view));
      const claimed = await store.claim('test-worker');
      await runJob(store, claimed.job, payload, async () => {});
      return readResult(store, created.id, 0, 1);
    }
    const r = await page(first);
    assert.deepEqual(
      r.rows.map((row) => row[0]),
      ['1', '2', '3'],
    );
    const cursor = tableCursor(
      first.fingerprint,
      first.sort,
      r.fields.map((f) => f.name),
      r.rows[1],
    );
    const next = await buildTableView(
      target,
      { user: readName, password },
      [],
      config,
      { objectId, pageSize: 2, cursor },
    );
    assert.deepEqual(
      (await page(next)).rows.map((row) => row[0]),
      ['3', '4', '5'],
    );
    await assert.rejects(
      buildTableView(target, { user: readName, password }, [], config, {
        objectId,
        pageSize: 2,
        cursor,
        filter: { column: 'id', operator: 'gt', value: '3' },
      }),
      { code: 'CURSOR_EXPIRED' },
    );
  },
);
test(
  'a trusted custom archive restores into a new private database without replacing its source',
  integration,
  async () => {
    const archiveFile = path.join(root, 'fixture.backup'),
      connection = admin.connectionParameters;
    const toolEnv = {
      PGHOST: target.host,
      PGPORT: String(target.port),
      PGUSER: connection.user,
      PGPASSWORD: connection.password,
      PGSSLMODE: 'disable',
    };
    const dump = process.env.WORKSPACE_PG_DUMP_BIN || 'pg_dump',
      restore = process.env.WORKSPACE_PG_RESTORE_BIN || 'pg_restore';
    await runTool(
      dump,
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        archiveFile,
        '--dbname',
        dataName,
      ],
      toolEnv,
      30000,
    );
    const source = {
      filename: 'fixture.backup',
      sizeBytes: fs.statSync(archiveFile).size,
    };
    const archive = await stageRecovery(
      store,
      1,
      source,
      {
        directory: root,
        maxBytes: 8 * 1024 * 1024,
        minFreeBytes: 0,
        storageBudget: config.storageBudgetBytes,
        binary: restore,
        targetMajor: target.major,
        ttlMinutes: 60,
      },
      (destination) => pipeline(fs.createReadStream(archiveFile), destination),
    );
    assert.match(archive.checksum, /^[a-f0-9]{64}$/);
    assert.equal(archive.archiveMajor, target.major);
    const recovery = {
      ...archive,
      destination: restoreDatabase,
      adminDatabase: connection.database,
      credential: { user: restoreName, password },
      binary: restore,
      serverMajor: target.major,
      minFreeBytes: 0,
    };
    const payload = {
      actorId: 1,
      target,
      credential: { user: writeName, password },
      statements: [],
      parameters: [],
      mode: 'maintenance',
      reason: 'isolated restore drill',
      limits: { ...config, jobMaxDurationMs: 30000 },
      policyHash: 'test',
      protectedObjects: [],
      recovery,
    };
    const created = await store.enqueue(payload, operationHash(recovery));
    const claimed = await store.claim('restore-test');
    assert.equal(claimed.job.id, created.id);
    await runRecovery(store, claimed.job, payload, async () => {});
    const finished = await store.get(created.id, 1);
    assert.equal(finished.status, 'succeeded', JSON.stringify(finished.error));
    assert.equal(finished.outcomes.length, 2);
    const verification = new pg.Client({
      host: target.host,
      port: target.port,
      database: restoreDatabase,
      user: restoreName,
      password,
    });
    await verification.connect();
    try {
      assert.equal(
        (
          await verification.query(
            'SELECT count(*)::int AS n FROM public.sample',
          )
        ).rows[0].n,
        6,
      );
      assert.equal(
        (
          await verification.query(
            "SELECT has_database_privilege('public',current_database(),'CONNECT') AS public_connect",
          )
        ).rows[0].public_connect,
        false,
      );
    } finally {
      await verification.end();
    }
    const original = await run('SELECT count(*) FROM sample');
    assert.equal((await readResult(store, original.id, 0, 1)).rows[0][0], '6');
  },
);
test(
  'schema inspection, same-state comparison and activity snapshots reflect real catalog objects',
  integration,
  async () => {
    const snapshot = await schemaSnapshot(
      target,
      { user: readName, password },
      [],
    );
    assert.ok(snapshot.nodes.some((n) => n.name === 'sample'));
    assert.ok(
      snapshot.objects.some((o) =>
        o.definition.includes('CREATE TABLE "public"."sample"'),
      ),
    );
    const comparison = compareSchemas(snapshot, snapshot);
    assert.equal(comparison.changes.length, 0);
    assert.equal(comparison.sql, '');
    const activity = await activitySnapshot(target, {
      user: readName,
      password,
    });
    assert.ok(activity.identity.measured_at);
    assert.ok(activity.tables.some((t) => t.relname === 'sample'));
    assert.equal(activity.workload.available, false);
  },
);

test(
  'restricted database identities enforce RLS and deny protected tables, role switching and server files',
  integration,
  async () => {
    const connection = supplied ? new URL(supplied) : undefined;
    if (connection) connection.pathname = dataName;
    const setup = new pg.Client(
      connection
        ? { connectionString: connection.toString() }
        : { ...connectConfig, database: dataName },
    );
    await setup.connect();
    const reader = new pg.Client({
      host: target.host,
      port: target.port,
      database: target.database,
      user: readName,
      password,
    });
    try {
      await setup.query(
        `CREATE TABLE public.workspace_protected(secret text); CREATE TABLE public.rls_sample(id integer,role_name text); INSERT INTO public.rls_sample VALUES(1,'${readName}'),(2,'other'); ALTER TABLE public.rls_sample ENABLE ROW LEVEL SECURITY; CREATE POLICY reader_identity ON public.rls_sample USING(role_name=current_user); GRANT SELECT ON public.rls_sample TO ${quoteIdentifier(readName)};`,
      );
      await reader.connect();
      await assertRestrictedIdentity(reader, target);
      assert.equal(
        (await reader.query('SELECT * FROM public.rls_sample')).rowCount,
        1,
      );
      await assert.rejects(
        reader.query('SELECT * FROM public.workspace_protected'),
        { code: '42501' },
      );
      await assert.rejects(reader.query('SET ROLE postgres'), {
        code: '42501',
      });
      await assert.rejects(
        reader.query("SELECT pg_read_file('postgresql.conf')"),
        { code: '42501' },
      );
      await setup.query(`GRANT postgres TO ${quoteIdentifier(readName)}`);
      await assert.rejects(assertRestrictedIdentity(reader, target), {
        code: 'UNSAFE_DATABASE_IDENTITY',
      });
    } finally {
      await setup
        .query(`REVOKE postgres FROM ${quoteIdentifier(readName)}`)
        .catch(() => {});
      await reader.end();
      await setup.query(
        'DROP TABLE IF EXISTS public.rls_sample,public.workspace_protected',
      );
      await setup.end();
    }
  },
);

test(
  'losing the COMMIT acknowledgement records unknown without replaying the committed write',
  integration,
  async () => {
    const sockets = new Set();
    let commitSent = false,
      tail = '';
    const proxy = net.createServer((socket) => {
      const upstream = net.connect({ host: target.host, port: target.port });
      sockets.add(socket);
      sockets.add(upstream);
      socket.on('error', () => {});
      upstream.on('error', () => socket.destroy());
      socket.on('data', (bytes) => {
        tail = (tail + bytes.toString('latin1')).slice(-1024);
        if (tail.includes('COMMIT\0')) commitSent = true;
        upstream.write(bytes);
      });
      upstream.on('data', (bytes) => {
        if (commitSent) {
          socket.destroy();
          upstream.destroy();
        } else socket.write(bytes);
      });
      socket.on('close', () => {
        upstream.destroy();
        sockets.delete(socket);
        sockets.delete(upstream);
      });
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const j = await enqueue(
      "UPDATE sample SET note='commit acknowledgement fixture' WHERE id=1",
      'write',
    );
    j.payload.target = { ...target, port: proxy.address().port };
    try {
      await runJob(store, j.job, j.payload, async () => {});
      const result = await store.get(j.job.id, 1);
      assert.equal(result.status, 'outcome_unknown');
      assert.equal(result.transactionOutcome, 'unknown');
      assert.equal(commitSent, true);
      // Resolve this synthetic uncertainty by observing the fixture, never replay.
      const reader = new pg.Client({
        host: target.host,
        port: target.port,
        database: target.database,
        user: readName,
        password,
      });
      await reader.connect();
      try {
        assert.equal(
          (await reader.query('SELECT note FROM sample WHERE id=1')).rows[0]
            .note,
          'commit acknowledgement fixture',
        );
      } finally {
        await reader.end();
      }
      await store.reconciled(j.job.id);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
    }
  },
);

test(
  'trusted provisioning separates protected control data, ordinary SQL and PostgreSQL 16/17 maintenance ownership',
  integration,
  async () => {
    const connection = supplied ? new URL(supplied) : undefined;
    if (connection) connection.pathname = dataName;
    const setup = new pg.Client(
      connection
        ? { connectionString: connection.toString() }
        : { ...connectConfig, database: dataName },
    );
    await setup.connect();
    const suffix = crypto.randomBytes(4).toString('hex'),
      prefix = `dw_fixture_${suffix}`,
      control = `omni_dw_test_${suffix}_bootstrap`,
      ordinary = `dw_example_${suffix}`;
    let provisioned;
    try {
      await setup.query('CREATE TABLE public.protected_bootstrap(secret text)');
      provisioned = await provisionWorkspaceRoles(setup, {
        database: dataName,
        controlDatabase: control,
        prefix,
        protectedObjects: ['protected_bootstrap'],
        manageOwnership: true,
      });
      const reader = new pg.Client({
        host: target.host,
        port: target.port,
        database: dataName,
        user: provisioned.names.read,
        password: provisioned.passwords.read,
      });
      await reader.connect();
      try {
        await assertRestrictedIdentity(reader, target);
        assert.equal((await reader.query('SELECT * FROM sample')).rowCount, 6);
        await assert.rejects(
          reader.query('SELECT * FROM protected_bootstrap'),
          { code: '42501' },
        );
        await assert.rejects(
          reader.query("UPDATE sample SET note='forbidden'"),
          { code: '42501' },
        );
        const owner = (
          await reader.query(
            "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname='protected_bootstrap'",
          )
        ).rows[0].owner;
        assert.notEqual(owner, provisioned.names.objects);
      } finally {
        await reader.end();
      }
      const maint = new pg.Client({
        host: target.host,
        port: target.port,
        database: dataName,
        user: provisioned.names.maintenance,
        password: provisioned.passwords.maintenance,
      });
      await maint.connect();
      try {
        await maint.query('ANALYZE public.sample');
        await maint.query(
          'ALTER TABLE public.sample ADD COLUMN provision_fixture text',
        );
        await maint.query(
          'ALTER TABLE public.sample DROP COLUMN provision_fixture',
        );
        await assert.rejects(
          maint.query(
            'ALTER TABLE public.protected_bootstrap ADD COLUMN forbidden text',
          ),
          { code: '42501' },
        );
      } finally {
        await maint.end();
      }
      const roles = new pg.Client({
        host: target.host,
        port: target.port,
        database: dataName,
        user: provisioned.names.roles,
        password: provisioned.passwords.roles,
      });
      await roles.connect();
      try {
        await roles.query(`CREATE ROLE ${quoteIdentifier(ordinary)} NOLOGIN`);
        const plan = await prepareRoleChange(
          target,
          {
            user: provisioned.names.read,
            password: provisioned.passwords.read,
          },
          Object.values(provisioned.names),
          { operation: 'drop', role: ordinary },
        );
        assert.equal(plan.sql[0], `DROP ROLE ${quoteIdentifier(ordinary)}`);
        await roles.query(plan.sql[0]);
      } finally {
        await roles.end();
      }
      const controlClient = new pg.Client({
        host: target.host,
        port: target.port,
        database: control,
        user: provisioned.names.control,
        password: provisioned.passwords.control,
      });
      await controlClient.connect();
      try {
        assert.equal(
          (await controlClient.query('SELECT current_database() AS name'))
            .rows[0].name,
          control,
        );
      } finally {
        await controlClient.end();
      }
    } finally {
      await setup.end();
      if (provisioned) {
        await admin.query(
          `DROP DATABASE ${quoteIdentifier(control)} WITH (FORCE)`,
        );
        const cleanup = new pg.Client(
          connection
            ? { connectionString: connection.toString() }
            : { ...connectConfig, database: dataName },
        );
        await cleanup.connect();
        try {
          for (const name of Object.values(provisioned.names)) {
            await cleanup.query(
              `REASSIGN OWNED BY ${quoteIdentifier(name)} TO ${quoteIdentifier((await admin.query('SELECT current_user AS name')).rows[0].name)}`,
            );
            await cleanup.query(`DROP OWNED BY ${quoteIdentifier(name)}`);
          }
        } finally {
          await cleanup.end();
        }
        for (const name of [
          ...Object.values(provisioned.names).reverse(),
          ordinary,
        ])
          await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(name)}`);
      }
    }
  },
);
