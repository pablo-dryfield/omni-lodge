import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawn} from 'child_process';
jest.mock('child_process',()=>({spawn:jest.fn()}));
jest.mock('../databaseWorkspace/controlBackup.js',()=>({backupWorkspaceControl:jest.fn()}));
import {backupWorkspaceControl} from '../databaseWorkspace/controlBackup';

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../utils/initializeAccessControl.js', () => ({
  initializeAccessControl: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../googleDrive.js', () => ({
  getDriveClient: jest.fn(),
  ensureFolderPath: jest.fn(),
}));
jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(),
  refreshConfigCacheKeys: jest.fn(async () => {}),
}));
import { getDriveClient, ensureFolderPath } from '../googleDrive';
import { getConfigValue } from '../configService';
import {
  listBackupCopies,
  deleteBackupCopy,
  syncLocalBackupsToDrive,
  executeBackupScript,
} from '../dbBackupService';

let directory: string;
let values: Record<string, unknown>;
let remote: Array<Record<string, unknown>>;
const content = Buffer.from('synthetic custom archive for adapter tests');
const originalControlUrl=process.env.DB_WORKSPACE_CONTROL_URL;
const hash = crypto.createHash('sha256').update(content).digest('hex');
const drive = {
  files: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
beforeEach(async () => {
  jest.clearAllMocks();
  directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'omnilodge-backup-adapter-'),
  );
  values = {
    DB_BACKUP_DIRECTORY: directory,
    DB_BACKUP_STORAGE: 'drive',
    DB_BACKUP_DRIVE_FOLDER: 'Backups',
    DB_BACKUP_KEEP_LOCAL_COPY: false,
  };
  (getConfigValue as jest.Mock).mockImplementation(
    (key: string) => values[key],
  );
  (getDriveClient as jest.Mock).mockResolvedValue(drive);
  (ensureFolderPath as jest.Mock).mockResolvedValue({ id: 'month' });
  remote = [
    {
      id: 'copy-a',
      name: 'fixture.backup',
      size: String(content.length),
      createdTime: '2026-11-03T00:00:00.000Z',
      modifiedTime: '2026-11-03T00:00:00.000Z',
      sha256Checksum: hash,
    },
  ];
  drive.files.list.mockImplementation(async ({ q }: { q: string }) => ({
    data: {
      files: q.includes("name = 'Backups'")
        ? [{ id: 'root-folder' }]
        : q.includes("name = 'Development'")
          ? [{ id: 'environment' }]
          : remote,
    },
  }));
  drive.files.get.mockImplementation(
    async ({ fileId }: { fileId: string }) => ({
      data: remote.find((f) => f.id === fileId),
    }),
  );
  drive.files.update.mockResolvedValue({ data: {} });
  drive.files.delete.mockResolvedValue({ data: {} });
  await fs.writeFile(path.join(directory, 'fixture.backup'), content);
});
afterEach(async () => {
  if(originalControlUrl===undefined)delete process.env.DB_WORKSPACE_CONTROL_URL;else process.env.DB_WORKSPACE_CONTROL_URL=originalControlUrl;
  // This path is allocated by mkdtemp above; never a configured real backup directory.
  if (
    !path.basename(directory).startsWith('omnilodge-backup-adapter-') ||
    path.dirname(directory) !== os.tmpdir()
  )
    throw new Error('Unsafe fixture cleanup');
  await fs.rm(directory, { recursive: true, force: true });
});
it('captures the independent journal after the application backup and respects its Control Panel switch',async()=>{
  const script=path.join(directory,'synthetic-script');await fs.writeFile(script,'synthetic',{mode:0o700});
  values.DB_BACKUP_SCRIPT=script;values.DB_BACKUP_STORAGE='local';
  process.env.DB_WORKSPACE_CONTROL_URL='postgresql://fixture:synthetic@127.0.0.1/control';
  (backupWorkspaceControl as jest.Mock).mockResolvedValue('workspace-control-fixture.backup');
  (spawn as jest.Mock).mockImplementation(()=>{const child=new EventEmitter() as EventEmitter&{stdout:EventEmitter;stderr:EventEmitter};child.stdout=new EventEmitter();child.stderr=new EventEmitter();queueMicrotask(()=>child.emit('close',0));return child;});
  await executeBackupScript();
  expect(backupWorkspaceControl).toHaveBeenCalledWith(expect.objectContaining({directory,connectionString:process.env.DB_WORKSPACE_CONTROL_URL,binary:'pg_dump',timeoutMs:900000}));
  values.DB_BACKUP_WORKSPACE_CONTROL_ENABLED=false;
  await executeBackupScript();expect(backupWorkspaceControl).toHaveBeenCalledTimes(1);
});
it('lists server and Drive copies separately without creating Drive folders', async () => {
  remote.push({ ...remote[0], id: 'copy-b' });
  const inventory = await listBackupCopies();
  expect(inventory.files.map((f) => f.id).sort()).toEqual([
    'drive:copy-a',
    'drive:copy-b',
    'local:fixture.backup',
  ]);
  expect(new Set(inventory.files.map((f) => f.fingerprint)).size).toBe(3);
  expect(inventory.stores.every((s) => s.available)).toBe(true);
  expect(ensureFolderPath).not.toHaveBeenCalled();
});
it('trashes the exact selected Drive ID and leaves the server and other Drive copy intact', async () => {
  remote.push({ ...remote[0], id: 'copy-b' });
  const copy = (await listBackupCopies()).files.find(
    (f) => f.id === 'drive:copy-b',
  )!;
  await deleteBackupCopy(copy.id, copy.fingerprint);
  expect(drive.files.update).toHaveBeenCalledWith(
    expect.objectContaining({
      fileId: 'copy-b',
      requestBody: { trashed: true },
    }),
    { timeout: 30000 },
  );
  expect(drive.files.delete).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(directory, 'fixture.backup'))).toEqual(
    content,
  );
});
it('requires explicit permanent deletion and rejects a changed fingerprint', async () => {
  const copy = (await listBackupCopies()).files.find(
    (f) => f.id === 'drive:copy-a',
  )!;
  remote[0].modifiedTime = '2026-11-04T00:00:00.000Z';
  await expect(
    deleteBackupCopy(copy.id, copy.fingerprint, true),
  ).rejects.toThrow(/changed/);
  expect(drive.files.delete).not.toHaveBeenCalled();
  const current = (await listBackupCopies()).files.find(
    (f) => f.id === copy.id,
  )!;
  await deleteBackupCopy(current.id, current.fingerprint, true);
  expect(drive.files.delete).toHaveBeenCalledWith(
    expect.objectContaining({ fileId: 'copy-a' }),
    { timeout: 30000 },
  );
});
it('does not treat unavailable Drive as an empty successful inventory', async () => {
  (getDriveClient as jest.Mock).mockRejectedValue(
    new Error('OAuth unavailable'),
  );
  const inventory = await listBackupCopies();
  expect(inventory.stores).toEqual(
    expect.arrayContaining([
      {
        location: 'drive',
        available: false,
        count: 0,
        message: expect.any(String),
      },
    ]),
  );
  expect(inventory.files.map((f) => f.id)).toEqual(['local:fixture.backup']);
});
it('retains a server archive when the existing same-name Drive copy cannot be verified', async () => {
  remote[0].sha256Checksum = 'different';
  const result = await syncLocalBackupsToDrive({
    deleteAfterUpload: true,
    skipExisting: true,
  });
  expect(result.failed).toEqual(['fixture.backup']);
  expect(result.skipped).toEqual([]);
  expect(await fs.readFile(path.join(directory, 'fixture.backup'))).toEqual(
    content,
  );
});
it.each(['both', 'keep-local'])(
  'retains the server archive for %s even if a caller asks to delete after upload',
  async (mode) => {
    if (mode === 'both') values.DB_BACKUP_STORAGE = 'both';
    else values.DB_BACKUP_KEEP_LOCAL_COPY = true;
    expect(
      (
        await syncLocalBackupsToDrive({
          deleteAfterUpload: true,
          skipExisting: true,
        })
      ).skipped,
    ).toEqual(['fixture.backup']);
    expect(await fs.readFile(path.join(directory, 'fixture.backup'))).toEqual(
      content,
    );
  },
);
it('removes only a verified server copy in Drive-only mode', async () => {
  expect(
    (
      await syncLocalBackupsToDrive({
        deleteAfterUpload: true,
        skipExisting: true,
      })
    ).skipped,
  ).toEqual(['fixture.backup']);
  await expect(
    fs.access(path.join(directory, 'fixture.backup')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(drive.files.update).not.toHaveBeenCalled();
  expect(drive.files.delete).not.toHaveBeenCalled();
});
