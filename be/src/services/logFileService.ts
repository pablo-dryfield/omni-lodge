import { promises as fs } from 'fs';
import path from 'path';
import HttpError from '../errors/HttpError.js';

export type LogTarget = 'backend' | 'ui';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MIN_LINES = 10;
const MAX_LINES = 1000;

const resolveLogPath = (target: LogTarget): string => {
  const cwd = process.cwd();
  if (target === 'backend') {
    return path.resolve(cwd, 'combined.log');
  }
  return path.resolve(cwd, '..', 'ui-server', 'combined.log');
};

const clampLines = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 200;
  }
  return Math.min(Math.max(Math.floor(value), MIN_LINES), MAX_LINES);
};

export const readLogTail = async (
  target: LogTarget,
  lines: number,
): Promise<{ output: string; lines: number }> => {
  const safeLines = clampLines(lines);
  const filePath = resolveLogPath(target);
  let stats: { size: number; isFile: () => boolean };

  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new HttpError(404, `Log file not found for ${target}`);
  }

  if (!stats.isFile()) {
    throw new HttpError(404, `Log file not found for ${target}`);
  }

  const size = stats.size;
  const readSize = Math.min(size, MAX_LOG_BYTES);
  const start = Math.max(0, size - readSize);
  const buffer = Buffer.alloc(readSize);

  const handle = await fs.open(filePath, 'r');
  try {
    await handle.read(buffer, 0, readSize, start);
  } finally {
    await handle.close();
  }

  const content = buffer.toString('utf8');
  const linesArr = content.split(/\r?\n/);
  const output = linesArr.slice(-safeLines).join('\n').trimEnd();

  return { output, lines: safeLines };
};
