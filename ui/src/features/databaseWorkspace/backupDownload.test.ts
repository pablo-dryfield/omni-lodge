import { downloadBackup } from './backupDownload';
import { downloadBookingBlob } from '../../utils/bookingTableExport';
jest.mock('../../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    getUri: ({ url }: { url: string }) => 'https://local.test/api' + url,
  },
}));
jest.mock('../../utils/bookingTableExport', () => ({
  downloadBookingBlob: jest.fn(),
}));
const fetchMock = jest.fn();
const browser = window as unknown as { showSaveFilePicker?: jest.Mock };
const copy = { id: 'drive:fixture', filename: 'fixture.backup', sizeBytes: 3 };
const writer = { write: jest.fn(), close: jest.fn(), abort: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  for (const method of Object.values(writer))
    method.mockResolvedValue(undefined);
  global.fetch = fetchMock;
  browser.showSaveFilePicker = jest.fn(async () => ({
    createWritable: async () => writer,
  }));
  localStorage.setItem('authToken', 'synthetic-token');
});
afterEach(() => {
  delete browser.showSaveFilePicker;
  localStorage.clear();
});
function response(chunks: Uint8Array[]) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true },
        releaseLock: jest.fn(),
      }),
    },
  };
}
it('streams an authenticated archive to disk without buffering it in a Blob', async () => {
  fetchMock.mockResolvedValue(
    response([new Uint8Array([1, 2]), new Uint8Array([3])]),
  );
  await downloadBackup(copy);
  expect(writer.write).toHaveBeenCalledTimes(2);
  expect(writer.close).toHaveBeenCalledTimes(1);
  expect(writer.abort).not.toHaveBeenCalled();
  expect(downloadBookingBlob).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith(
    'https://local.test/api/database-workspace/backups/drive%3Afixture/download',
    expect.objectContaining({
      headers: { Authorization: 'Bearer synthetic-token' },
      credentials: 'include',
      cache: 'no-store',
    }),
  );
});
it('aborts an incomplete file without marking it complete', async () => {
  fetchMock.mockResolvedValue(response([new Uint8Array([1])]));
  await expect(downloadBackup(copy)).rejects.toThrow(/incomplete/);
  expect(writer.abort).toHaveBeenCalledTimes(1);
  expect(writer.close).not.toHaveBeenCalled();
});
it('does not fetch large archives into memory in a browser without streaming file support', async () => {
  delete browser.showSaveFilePicker;
  await expect(
    downloadBackup({ ...copy, sizeBytes: 40 * 1024 * 1024 }),
  ).rejects.toThrow(/Chrome or Edge/);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('stops on revoked authorization and aborts the unfinished disk file', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await expect(downloadBackup(copy)).rejects.toThrow(/403/);
  expect(writer.abort).toHaveBeenCalledTimes(1);
  expect(writer.close).not.toHaveBeenCalled();
});
