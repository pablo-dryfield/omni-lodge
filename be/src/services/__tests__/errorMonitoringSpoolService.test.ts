import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';

import { ErrorMonitoringDiskSpool } from '../errorMonitoringSpoolService.js';

type TestEvent = { clientEventId: string; message: string };

describe('error monitoring disk spool', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-monitoring-spool-'));
    filePath = path.join(directory, 'failed-events.ndjson');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes durable NDJSON with restrictive file permissions', () => {
    const activeFilePath = `${filePath}.test.active`;
    const spool = new ErrorMonitoringDiskSpool<TestEvent>({ filePath, writerId: 'test' });
    expect(spool.append({ clientEventId: 'server-spool:one', message: 'boom' }, { durable: true })).toBe(true);

    const stored = JSON.parse(readFileSync(activeFilePath, 'utf8').trim()) as { event: TestEvent };
    expect(stored.event).toEqual({ clientEventId: 'server-spool:one', message: 'boom' });
    if (process.platform !== 'win32') {
      expect(statSync(activeFilePath).mode & 0o777).toBe(0o600);
    }
  });

  it('bounds both segment bytes and record count by rotating old data', () => {
    const diagnostics: string[] = [];
    const spool = new ErrorMonitoringDiskSpool<TestEvent>({
      filePath,
      segmentBytes: 64 * 1024,
      maxBytes: 3 * 64 * 1024,
      maxRecordsPerSegment: 100,
      onDiagnostic: (message) => diagnostics.push(message),
      writerId: 'test',
    });

    for (let index = 0; index < 450; index += 1) {
      expect(spool.append({ clientEventId: `event-${index}`, message: 'small' })).toBe(true);
    }

    const stats = spool.getStats();
    expect(stats.files).toBeLessThanOrEqual(3);
    expect(stats.bytes).toBeLessThanOrEqual(3 * 64 * 1024);
    expect(stats.records).toBeLessThanOrEqual(300);
    expect(stats.evictedRecords).toBeGreaterThanOrEqual(100);
    expect(stats.evictedBytes).toBeGreaterThan(0);
    expect(diagnostics.some((message) => message.includes('spool capacity evicted records='))).toBe(true);
  });

  it('replays valid records, skips malformed lines, and removes drained segments', async () => {
    const activeFilePath = `${filePath}.test.active`;
    const spool = new ErrorMonitoringDiskSpool<TestEvent>({ filePath, writerId: 'test' });
    spool.append({ clientEventId: 'event-1', message: 'first' });
    spool.append({ clientEventId: 'event-2', message: 'second' });
    writeFileSync(activeFilePath, `${readFileSync(activeFilePath, 'utf8')}not-json\n`, 'utf8');
    const seen: string[] = [];

    const result = await spool.replay(async (event) => {
      seen.push(event.clientEventId);
    });

    expect(seen).toEqual(['event-1', 'event-2']);
    expect(result).toEqual(expect.objectContaining({ persisted: 2, retained: 0, malformed: 1 }));
    expect(spool.getStats()).toEqual({
      files: 0,
      bytes: 0,
      records: 0,
      evictedRecords: 0,
      evictedBytes: 0,
    });
  });

  it('retains the failed record and all later records for an at-least-once retry', async () => {
    const spool = new ErrorMonitoringDiskSpool<TestEvent>({ filePath, writerId: 'test' });
    spool.append({ clientEventId: 'stable-1', message: 'first' });
    spool.append({ clientEventId: 'stable-2', message: 'second' });

    const failed = await spool.replay(async () => {
      throw new Error('database offline');
    });
    expect(failed).toEqual(expect.objectContaining({ persisted: 0, retained: 2 }));
    expect(spool.getStats().records).toBe(2);

    const seen: string[] = [];
    const recovered = await spool.replay(async (event) => {
      seen.push(event.clientEventId);
    });
    expect(recovered.persisted).toBe(2);
    expect(seen).toEqual(['stable-1', 'stable-2']);
  });

  it('keeps live PM2 writers and in-progress replay claims isolated', async () => {
    const first = new ErrorMonitoringDiskSpool<TestEvent>({
      filePath,
      writerId: 'worker-a',
      staleClaimMs: 60_000,
    });
    const second = new ErrorMonitoringDiskSpool<TestEvent>({
      filePath,
      writerId: 'worker-b',
      staleClaimMs: 60_000,
    });
    first.append({ clientEventId: 'from-a', message: 'first worker' });
    second.append({ clientEventId: 'from-b', message: 'second worker' });
    const secondActive = `${filePath}.worker-b.active`;
    const secondClaim = `${filePath}.processing.worker-b.live-claim`;
    renameSync(secondActive, secondClaim);
    const seen: string[] = [];

    await first.replay(async (event) => {
      seen.push(event.clientEventId);
    });

    expect(seen).toEqual(['from-a']);
    expect(existsSync(secondClaim)).toBe(true);
  });

  it('atomically recovers an abandoned writer file after the stale window', async () => {
    const survivor = new ErrorMonitoringDiskSpool<TestEvent>({
      filePath,
      writerId: 'survivor',
      staleClaimMs: 60_000,
    });
    const abandoned = new ErrorMonitoringDiskSpool<TestEvent>({
      filePath,
      writerId: 'old-worker',
      staleClaimMs: 60_000,
    });
    abandoned.append({ clientEventId: 'abandoned-event', message: 'recover me' });
    const abandonedPath = `${filePath}.old-worker.active`;
    const old = new Date(Date.now() - 2 * 60_000);
    utimesSync(abandonedPath, old, old);
    const seen: string[] = [];

    await survivor.replay(async (event) => {
      seen.push(event.clientEventId);
    });

    expect(seen).toEqual(['abandoned-event']);
    expect(existsSync(abandonedPath)).toBe(false);
  });

  it('rejects oversized records without exposing their payload in diagnostics', () => {
    const diagnostics: string[] = [];
    const spool = new ErrorMonitoringDiskSpool<TestEvent>({
      filePath,
      segmentBytes: 64 * 1024,
      maxBytes: 256 * 1024,
      onDiagnostic: (message) => diagnostics.push(message),
      writerId: 'test',
    });
    const privateValue = 'never-log-this-value';

    expect(spool.append({
      clientEventId: 'too-large',
      message: `${privateValue}${'x'.repeat(70 * 1024)}`,
    })).toBe(false);
    expect(diagnostics.join(' ')).not.toContain(privateValue);
    expect(spool.getStats()).toEqual({
      files: 0,
      bytes: 0,
      records: 0,
      evictedRecords: 0,
      evictedBytes: 0,
    });
  });
});
