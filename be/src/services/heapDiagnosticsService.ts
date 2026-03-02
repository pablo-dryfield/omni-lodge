import { mkdir, readdir, stat } from 'fs/promises';
import path from 'path';
import { writeHeapSnapshot } from 'v8';

export type HeapSnapshotFile = {
  fileName: string;
  filePath: string;
  sizeMb: number;
  createdAt: string;
};

const SNAPSHOT_DIR = path.join(process.cwd(), 'runtime', 'performance', 'heap-snapshots');
const SNAPSHOT_LIMIT = 20;

const round = (value: number, digits = 2): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

class HeapDiagnosticsService {
  async captureSnapshot(): Promise<HeapSnapshotFile> {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `heap-${process.pid}-${timestamp}.heapsnapshot`;
    const filePath = writeHeapSnapshot(path.join(SNAPSHOT_DIR, fileName));
    const snapshotStat = await stat(filePath);

    return {
      fileName,
      filePath,
      sizeMb: round(snapshotStat.size / (1024 * 1024)),
      createdAt: snapshotStat.birthtime.toISOString(),
    };
  }

  async listSnapshots(): Promise<HeapSnapshotFile[]> {
    try {
      const entries = await readdir(SNAPSHOT_DIR, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.heapsnapshot'))
          .map(async (entry) => {
            const filePath = path.join(SNAPSHOT_DIR, entry.name);
            const fileStat = await stat(filePath);
            return {
              fileName: entry.name,
              filePath,
              sizeMb: round(fileStat.size / (1024 * 1024)),
              createdAt: fileStat.birthtime.toISOString(),
            } satisfies HeapSnapshotFile;
          }),
      );

      return files
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, SNAPSHOT_LIMIT);
    } catch {
      return [];
    }
  }

  getSnapshotDirectory(): string {
    return SNAPSHOT_DIR;
  }
}

export const heapDiagnosticsService = new HeapDiagnosticsService();
