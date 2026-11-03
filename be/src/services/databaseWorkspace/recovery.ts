import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { targetClient } from './connection.js';
import { quoteIdentifier } from './filters.js';
import { sealed, opened, type WorkspaceStore } from './store.js';
import {
  WorkspaceError,
  errorInfo,
  type JobPayload,
  type JobRecord,
  type StatementOutcome,
} from './types.js';

type Recovery = NonNullable<JobPayload['recovery']>;
const encryptionKey = () => {
  if (!process.env.CONFIG_ENCRYPTION_KEY)
    throw new WorkspaceError(
      503,
      'ENCRYPTION_KEY',
      'Restore encryption key is unavailable.',
    );
  return crypto
    .createHash('sha256')
    .update(process.env.CONFIG_ENCRYPTION_KEY)
    .digest();
};
const archivePath = (directory: string, id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new WorkspaceError(400, 'ARCHIVE_ID', 'Invalid archive reference.');
  return path.join(path.resolve(directory), `restore-${id}`);
};
export async function initializeRecovery(store: WorkspaceStore): Promise<void> {
  await store.pool.query(
    `CREATE TABLE IF NOT EXISTS database_workspace.restore_archives(id uuid PRIMARY KEY,actor_id bigint NOT NULL,directory text NOT NULL,bytes bigint NOT NULL,metadata jsonb NOT NULL,expires_at timestamptz NOT NULL,job_id uuid,created_at timestamptz NOT NULL DEFAULT now());`,
  );
}
export async function diskHeadroom(
  directory: string,
  required: number,
  minFree: number,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.statfs(directory);
  if (Number(info.bavail) * Number(info.bsize) < required + minFree)
    throw new WorkspaceError(
      507,
      'RESTORE_DISK_SPACE',
      'The worker does not have enough verified free disk space for staging and restore temporary files.',
    );
}
export async function runTool(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      settled = false;
    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < 32768)
        stdout += data.toString('utf8').slice(0, 32768 - stdout.length);
    });
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < 32768)
        stderr += data.toString('utf8').slice(0, 32768 - stderr.length);
    });
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
        child.kill('SIGTERM');
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
        killTimer.unref();
      },
      timer = setTimeout(stop, timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', stop, { once: true });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    child.on('error', () =>
      finish(
        new WorkspaceError(
          503,
          'RESTORE_TOOL',
          'The configured PostgreSQL restore executable could not be started.',
        ),
      ),
    );
    child.on('close', (code) =>
      finish(
        code === 0 && !signal?.aborted
          ? undefined
          : new WorkspaceError(
              409,
              signal?.aborted ? 'RESTORE_CANCELLED' : 'RESTORE_TOOL_FAILED',
              signal?.aborted
                ? 'Restore was cancelled. Inspect the isolated destination before retrying.'
                : `PostgreSQL restore tool failed: ${stderr.slice(0, 8000) || 'nonzero exit status or timeout'}`,
            ),
      ),
    );
    if (signal?.aborted) stop();
  });
}
async function decryptArchive(
  recovery: Pick<
    Recovery,
    'directory' | 'archiveId' | 'cipherIv' | 'cipherTag' | 'checksum'
  >,
  destination: string,
): Promise<void> {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(recovery.cipherIv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(recovery.cipherTag, 'hex'));
  const hash = crypto.createHash('sha256');
  await pipeline(
    createReadStream(
      path.join(
        archivePath(recovery.directory, recovery.archiveId),
        'archive.enc',
      ),
    ),
    decipher,
    new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
  if (hash.digest('hex') !== recovery.checksum)
    throw new WorkspaceError(
      409,
      'RESTORE_CHECKSUM',
      'The staged archive checksum differs from its reviewed manifest.',
    );
}
export async function stageRecovery(
  store: WorkspaceStore,
  actorId: number,
  source: {
    filename: string;
    sizeBytes: number;
    id?: string;
    location?: 'local' | 'drive';
    sha256Checksum?: string;
  },
  options: {
    directory: string;
    maxBytes: number;
    minFreeBytes: number;
    storageBudget: number;
    binary: string;
    targetMajor: number;
    ttlMinutes: number;
    expansionFactor?: number;
  },
  streamSource: (destination: NodeJS.WritableStream) => Promise<void>,
) {
  if (source.sizeBytes > options.maxBytes || source.sizeBytes < 5)
    throw new WorkspaceError(
      413,
      'RESTORE_ARCHIVE_SIZE',
      'The trusted backup exceeds the restore archive budget or is empty.',
    );
  await diskHeadroom(
    options.directory,
    source.sizeBytes * (2 + (options.expansionFactor || 6)),
    options.minFreeBytes,
  );
  await store.reserveBytes(source.sizeBytes, options.storageBudget);
  const id = crypto.randomUUID(),
    directory = archivePath(options.directory, id),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv),
    hash = crypto.createHash('sha256');
  let bytes = 0,
    header = Buffer.alloc(0),
    saved = false;
  await fs.mkdir(directory, { mode: 0o700 });
  const plaintext = path.join(directory, 'inspection.backup'),
    sourceStream = new PassThrough();
  const watchdog = setTimeout(
    () => sourceStream.destroy(new Error('Archive staging timed out')),
    300000,
  );
  watchdog.unref();
  try {
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > source.sizeBytes || bytes > options.maxBytes) {
          done(
            new WorkspaceError(
              413,
              'RESTORE_ARCHIVE_SIZE',
              'Backup size changed while staging.',
            ),
          );
          return;
        }
        if (header.length < 5) {
          header = Buffer.concat([
            header,
            chunk.subarray(0, 5 - header.length),
          ]);
          if (header.length === 5 && header.toString('ascii') !== 'PGDMP') {
            done(
              new WorkspaceError(
                400,
                'RESTORE_FORMAT',
                'Only trusted PostgreSQL custom-format archives are supported.',
              ),
            );
            return;
          }
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });
    const transferred = pipeline(
      sourceStream,
      meter,
      cipher,
      createWriteStream(path.join(directory, 'archive.enc'), {
        flags: 'wx',
        mode: 0o600,
      }),
    );
    await Promise.all([
      transferred,
      streamSource(sourceStream).catch((error) => {
        sourceStream.destroy(error as Error);
        throw error;
      }),
    ]);
    if (bytes !== source.sizeBytes)
      throw new WorkspaceError(
        409,
        'RESTORE_ARCHIVE_SIZE',
        'Backup size changed while staging.',
      );
    const checksum = hash.digest('hex');
    if (source.sha256Checksum && checksum !== source.sha256Checksum)
      throw new WorkspaceError(
        409,
        'RESTORE_SOURCE_CHECKSUM',
        'The downloaded archive does not match its Google Drive SHA-256 metadata.',
      );
    const manifest = {
      directory: path.resolve(options.directory),
      archiveId: id,
      cipherIv: iv.toString('hex'),
      cipherTag: cipher.getAuthTag().toString('hex'),
      checksum,
      bytes,
      sourceFilename: source.filename,
      sourceCopyId: source.id,
      sourceLocation: source.location,
    };
    await decryptArchive(manifest, plaintext);
    const version = await runTool(options.binary, ['--version'], {}, 10000),
      toolMajor = Number(/\b(\d+)\./.exec(version.stdout)?.[1]);
    const listing = await runTool(
        options.binary,
        ['--list', plaintext],
        {},
        30000,
      ),
      archiveMajor = Number(
        /Dumped from database version: (\d+)/.exec(listing.stdout)?.[1],
      ),
      dumpToolMajor = Number(
        /Dumped by pg_dump version: (\d+)/.exec(listing.stdout)?.[1],
      );
    if (
      !toolMajor ||
      !archiveMajor ||
      toolMajor < dumpToolMajor ||
      options.targetMajor < archiveMajor ||
      toolMajor !== options.targetMajor
    )
      throw new WorkspaceError(
        409,
        'RESTORE_VERSION',
        'Use a restore tool matching the destination server major; the archive/dump tool must be compatible and not newer than that server.',
      );
    const metadata = {
      ...manifest,
      archiveMajor,
      toolMajor,
      expansionFactor: options.expansionFactor || 6,
    };
    await store.pool.query(
      "INSERT INTO database_workspace.restore_archives(id,actor_id,directory,bytes,metadata,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6::int*interval '1 minute')",
      [
        id,
        actorId,
        manifest.directory,
        bytes,
        sealed(metadata),
        options.ttlMinutes,
      ],
    );
    saved = true;
    await store.audit(actorId, 'restore_archive_staged', {
      id,
      source: source.filename,
      bytes,
      checksum: manifest.checksum,
      archiveMajor,
      toolMajor,
    });
    return metadata;
  } finally {
    clearTimeout(watchdog);
    await fs.rm(plaintext, { force: true }).catch(() => {});
    if (!saved) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      await store.releaseBytes(source.sizeBytes);
    }
  }
}
export async function recoveryArchive(
  store: WorkspaceStore,
  id: string,
  actorId: number,
): Promise<
  Omit<
    Recovery,
    | 'credential'
    | 'adminDatabase'
    | 'destination'
    | 'binary'
    | 'serverMajor'
    | 'minFreeBytes'
  >
> {
  const r = await store.pool.query(
    'SELECT metadata FROM database_workspace.restore_archives WHERE id=$1 AND actor_id=$2 AND expires_at>now()',
    [id, actorId],
  );
  if (!r.rowCount)
    throw new WorkspaceError(
      410,
      'RESTORE_ARCHIVE_EXPIRED',
      'Stage the trusted backup again; this archive expired.',
    );
  return opened(r.rows[0].metadata);
}
export async function runRecovery(
  store: WorkspaceStore,
  job: JobRecord,
  payload: JobPayload,
  authorize: () => Promise<void>,
): Promise<void> {
  const r = payload.recovery!;
  let created = false,
    committed = false,
    checking = false;
  const controller = new AbortController(),
    outcomes: StatementOutcome[] = [];
  const client = targetClient(
      { ...payload.target, database: r.adminDatabase },
      r.credential,
      `omnilodge-workspace:${job.id}`,
    ),
    file = path.join(archivePath(r.directory, r.archiveId), `${job.id}.backup`);
  client.on('error', () => controller.abort());
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void store
      .heartbeat(job.id, job.workerId!, job.generation)
      .then((state) => {
        if (!state || state.status === 'cancel_requested') controller.abort();
      })
      .catch(() => controller.abort())
      .finally(() => {
        checking = false;
      });
  }, 500);
  timer.unref();
  try {
    await authorize();
    if (
      !/^omnilodge_restore_\d{8}_[a-f0-9]{8}$/.test(r.destination) ||
      r.destination === payload.target.database ||
      r.destination === r.adminDatabase
    )
      throw new WorkspaceError(
        403,
        'RESTORE_DESTINATION',
        'Only a new server-generated isolated destination is permitted.',
      );
    await diskHeadroom(
      r.directory,
      r.bytes * (1 + r.expansionFactor),
      r.minFreeBytes,
    );
    await decryptArchive(r, file);
    await client.connect();
    const identity = (
      await client.query(
        "SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,current_setting('server_version_num')::int/10000 AS major FROM pg_roles r WHERE rolname=current_user",
      )
    ).rows[0];
    if (
      !identity ||
      !identity.rolcreatedb ||
      identity.rolsuper ||
      identity.rolcreaterole ||
      identity.rolreplication ||
      identity.rolbypassrls ||
      Number(identity.major) !== r.serverMajor
    )
      throw new WorkspaceError(
        503,
        'RESTORE_IDENTITY',
        'Provision a dedicated nonsuperuser CREATEDB restore identity without role creation, replication or RLS bypass.',
      );
    const backend = (
      await client.query(
        'SELECT pg_backend_pid() AS pid,backend_start::text AS start FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      )
    ).rows[0];
    await store.backend(
      job.id,
      job.workerId!,
      job.generation,
      backend.pid,
      backend.start,
    );
    if (
      (
        await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [
          r.destination,
        ])
      ).rowCount
    )
      throw new WorkspaceError(
        409,
        'RESTORE_DESTINATION_EXISTS',
        'The isolated destination already exists. No database was overwritten.',
      );
    await authorize();
    if (controller.signal.aborted)
      throw new WorkspaceError(
        409,
        'RESTORE_CANCELLED',
        'Restore cancelled before creating the destination.',
      );
    await client.query(
      `CREATE DATABASE ${quoteIdentifier(r.destination)} TEMPLATE template0`,
    );
    created = true;
    await client.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdentifier(r.destination)} FROM PUBLIC`,
    );
    outcomes.push({
      index: 0,
      kind: 'restore',
      sql: `Created private isolated database ${r.destination}; source ${r.sourceFilename}; SHA-256 ${r.checksum}`,
      sourceStart: 0,
      sourceEnd: 0,
      durationMs: 0,
    });
    await store.progress(job, outcomes);
    const caFile = path.join(
      archivePath(r.directory, r.archiveId),
      `${job.id}.ca.pem`,
    );
    if (payload.target.ca)
      await fs.writeFile(caFile, payload.target.ca, {
        mode: 0o600,
        flag: 'wx',
      });
    await runTool(
      r.binary,
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        '--no-tablespaces',
        '--no-subscriptions',
        '--dbname',
        r.destination,
        file,
      ],
      {
        PGHOST: payload.target.host,
        PGPORT: String(payload.target.port),
        PGUSER: r.credential.user,
        PGPASSWORD: r.credential.password,
        PGAPPNAME: `omnilodge-workspace:${job.id}:restore`,
        PGSSLMODE: payload.target.tls ? 'verify-full' : 'disable',
        ...(payload.target.ca ? { PGSSLROOTCERT: caFile } : {}),
      },
      payload.limits.jobMaxDurationMs,
      controller.signal,
    );
    committed = true;
    const verify = targetClient(
      { ...payload.target, database: r.destination },
      r.credential,
      'omnilodge-workspace-restore-verification',
    );
    try {
      await verify.connect();
      const checks = (
        await verify.query(`SELECT current_database() AS database,current_user AS owner,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS tables,
      (SELECT count(*)::int FROM pg_constraint WHERE NOT convalidated) AS unvalidated_constraints,
      (SELECT count(*)::int FROM pg_index WHERE NOT indisvalid OR NOT indisready) AS invalid_indexes,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='SequelizeMeta') AS has_migration_ledger`)
      ).rows[0];
      if (checks.invalid_indexes || checks.unvalidated_constraints)
        throw new WorkspaceError(
          409,
          'RESTORE_POSTCHECK',
          'Restore completed but invalid indexes or unvalidated constraints require inspection. The isolated database was preserved.',
        );
      outcomes.push({
        index: 1,
        kind: 'restore-verification',
        sql: JSON.stringify({
          ...checks,
          applicationSchemaSync: false,
          accessControlReseed: false,
          pitrVerified: false,
          sourceChecksum: r.checksum,
        }),
        sourceStart: 0,
        sourceEnd: 0,
        durationMs: 0,
      });
    } finally {
      await verify.end().catch(() => {});
    }
    await authorize();
    await store.finish(job, 'succeeded', 'not_applicable', outcomes);
    await store.audit(
      payload.actorId,
      'isolated_restore_verified',
      {
        destination: r.destination,
        source: r.sourceFilename,
        checksum: r.checksum,
        toolMajor: r.toolMajor,
        serverMajor: r.serverMajor,
      },
      payload.target.id,
      job.id,
    );
  } catch (error) {
    await store
      .finish(
        job,
        controller.signal.aborted ? 'cancelled' : 'failed',
        created ? 'partial' : 'not_started',
        outcomes,
        {
          ...errorInfo(error),
          detail: created
            ? `Isolated destination preserved: ${r.destination}; archive restore ${committed ? 'committed' : 'not confirmed'}. Source/application database was not replaced.`
            : undefined,
        },
      )
      .catch(() => {});
  } finally {
    clearInterval(timer);
    while (checking) await new Promise((resolve) => setTimeout(resolve, 10));
    await client.end().catch(() => {});
    await cleanupRecoveryPlaintext(payload, job.id);
  }
}
export async function cleanupRecoveryPlaintext(
  payload: JobPayload,
  jobId: string,
): Promise<void> {
  if (!payload.recovery || !/^[a-f0-9-]{36}$/.test(jobId)) return;
  const root = archivePath(
    payload.recovery.directory,
    payload.recovery.archiveId,
  );
  for (const suffix of ['.backup', '.ca.pem'])
    await fs
      .rm(path.join(root, `${jobId}${suffix}`), { force: true })
      .catch(() => {});
}
export async function cleanupRecovery(store: WorkspaceStore): Promise<void> {
  const c = await store.pool.connect();
  try {
    await c.query('BEGIN');
    const rows = await c.query(
      `SELECT a.* FROM database_workspace.restore_archives a WHERE a.expires_at<now() AND NOT EXISTS(SELECT 1 FROM database_workspace.jobs j WHERE j.archive_id=a.id AND (j.status IN ('queued','running','cancel_requested') OR (j.status='outcome_unknown' AND NOT j.backend_reconciled))) FOR UPDATE SKIP LOCKED LIMIT 10`,
    );
    for (const row of rows.rows) {
      await fs.rm(archivePath(row.directory, row.id), {
        recursive: true,
        force: true,
      });
      await c.query(
        'DELETE FROM database_workspace.restore_archives WHERE id=$1',
        [row.id],
      );
      await c.query(
        'UPDATE database_workspace.storage_budget SET bytes=GREATEST(0,bytes-$1) WHERE id=1',
        [row.bytes],
      );
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
