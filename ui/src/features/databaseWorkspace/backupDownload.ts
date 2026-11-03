import axios from '../../utils/axiosInstance';
import { downloadBookingBlob } from '../../utils/bookingTableExport';
type FileWriter = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};
type Picker = (options: {
  suggestedName: string;
}) => Promise<{ createWritable: () => Promise<FileWriter> }>;
// Stream large archives to a user-selected file instead of buffering a database
// dump in the tab. Browsers without the file API have a bounded Blob fallback.
export async function downloadBackup(copy: {
  id: string;
  filename: string;
  sizeBytes: number;
}): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker })
    .showSaveFilePicker;
  if (!picker && copy.sizeBytes > 32 * 1024 * 1024)
    throw new Error(
      'For archives over 32 MiB, download using desktop Chrome or Edge so the file can be streamed directly to disk.',
    );
  let writer: FileWriter | undefined;
  if (picker) {
    try {
      writer = await (
        await picker.call(window, { suggestedName: copy.filename })
      ).createWritable();
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      throw error;
    }
  }
  const controller = new AbortController(),
    timeout = window.setTimeout(() => controller.abort(), 900000);
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(
      axios.getUri({
        url: `/database-workspace/backups/${encodeURIComponent(copy.id)}/download`,
      }),
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (!response.ok || !response.body)
      throw new Error(
        `Backup download failed (${response.status}). Refresh the inventory and check your backup/export permissions.`,
      );
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > copy.sizeBytes || (!writer && bytes > 32 * 1024 * 1024)) {
          controller.abort();
          throw new Error(
            'Backup size changed or exceeded the browser download limit. Refresh the inventory.',
          );
        }
        if (writer) await writer.write(chunk.value);
        else parts.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (bytes !== copy.sizeBytes)
      throw new Error(
        'The backup download was incomplete. No completed file was saved.',
      );
    if (writer) await writer.close();
    else
      downloadBookingBlob(
        new Blob(parts, { type: 'application/octet-stream' }),
        copy.filename,
      );
  } catch (error) {
    await writer?.abort().catch(() => {});
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
