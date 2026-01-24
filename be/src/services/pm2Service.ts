import { spawn } from 'child_process';
import HttpError from '../errors/HttpError.js';

export type Pm2ProcessSummary = {
  id: number;
  name: string;
  status: string;
  pid: number | null;
  uptime: number | null;
};

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  args: string[];
};

type Pm2ProcessEntry = {
  pm_id?: number | string;
  name?: string;
  pid?: number;
  pm2_env?: {
    status?: string;
    pid?: number;
    pm_uptime?: number;
  };
};

const runPm2Command = (args: string[]): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn('pm2', args, { env: process.env });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString('utf8'));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    child.on('error', (error) => {
      reject(new HttpError(500, `Failed to execute pm2: ${error.message}`));
    });

    child.on('close', (code) => {
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      if (code !== 0) {
        reject(
          new HttpError(500, `pm2 ${args.join(' ')} failed`, {
            exitCode: code,
            stdout,
            stderr,
          }),
        );
        return;
      }
      resolve({
        exitCode: code,
        stdout,
        stderr,
        args,
      });
    });
  });
};

const parseProcessId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const candidate = Number.parseInt(value, 10);
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
};

const normalizeStatus = (value: unknown): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return 'unknown';
};

const isActiveStatus = (status: string): boolean => {
  const normalized = status.toLowerCase();
  return normalized !== 'stopped' && normalized !== 'stopping';
};

export const listPm2Processes = async (): Promise<Pm2ProcessSummary[]> => {
  const result = await runPm2Command(['jlist']);
  const payload = result.stdout.trim();
  if (!payload) {
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new HttpError(500, 'Failed to parse PM2 process list', {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const processes = data
    .map((entry) => {
      const record = entry as Pm2ProcessEntry;
      const id = parseProcessId(record.pm_id);
      if (id == null) {
        return null;
      }
      const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : `Process ${id}`;
      const status = normalizeStatus(record.pm2_env?.status);
      const pid =
        typeof record.pid === 'number'
          ? record.pid
          : typeof record.pm2_env?.pid === 'number'
            ? record.pm2_env.pid
            : null;
      const uptime = typeof record.pm2_env?.pm_uptime === 'number' ? record.pm2_env.pm_uptime : null;

      return {
        id,
        name,
        status,
        pid,
        uptime,
      };
    })
    .filter((entry): entry is Pm2ProcessSummary => Boolean(entry))
    .filter((entry) => isActiveStatus(entry.status))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  return processes;
};

export const restartPm2Process = async (id: number): Promise<CommandResult> => {
  if (!Number.isFinite(id)) {
    throw new HttpError(400, 'PM2 process id must be a number');
  }
  return runPm2Command(['restart', id.toString()]);
};

export const getPm2ProcessLogs = async (id: number, lines: number): Promise<CommandResult> => {
  if (!Number.isFinite(id)) {
    throw new HttpError(400, 'PM2 process id must be a number');
  }
  const safeLines = Math.min(Math.max(Math.floor(lines), 10), 1000);
  return runPm2Command(['logs', id.toString(), '--lines', safeLines.toString(), '--nostream', '--raw']);
};
