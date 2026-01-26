import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import HttpError from '../errors/HttpError.js';

export type MaintenanceCommandAction =
  | 'git-pull'
  | 'migrate-prod'
  | 'sync-access-control-prod';

export type MaintenanceCommandResult = {
  action: MaintenanceCommandAction;
  status: 'success' | 'failed';
  exitCode: number | null;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
};

type CommandSpec = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

const OUTPUT_LIMIT = 20_000;

const truncateOutput = (value: string): string => {
  if (value.length <= OUTPUT_LIMIT) {
    return value;
  }
  return `${value.slice(0, OUTPUT_LIMIT)}\n\n[truncated ${value.length - OUTPUT_LIMIT} characters]`;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..');
const backendRoot = resolve(__dirname, '..', '..');

const commandMap: Record<MaintenanceCommandAction, CommandSpec> = {
  'git-pull': {
    command: 'git',
    args: ['pull', 'origin', 'master'],
    cwd: repoRoot,
  },
  'migrate-prod': {
    command: 'npm',
    args: ['run', 'migrate:prod'],
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
  },
  'sync-access-control-prod': {
    command: 'npm',
    args: ['run', 'sync:access-control:prod'],
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
  },
};

const runCommand = (spec: CommandSpec): Promise<Omit<MaintenanceCommandResult, 'action' | 'status'>> =>
  new Promise((resolveResult, reject) => {
    const startedAt = Date.now();
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      shell: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new HttpError(500, `Failed to execute ${spec.command}: ${error.message}`));
    });
    child.on('close', (exitCode) => {
      resolveResult({
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        command: spec.command,
        args: spec.args,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        durationMs: Date.now() - startedAt,
      });
    });
  });

export const executeMaintenanceCommand = async (
  action: MaintenanceCommandAction,
): Promise<MaintenanceCommandResult> => {
  const spec = commandMap[action];
  if (!spec) {
    throw new HttpError(400, 'Unsupported maintenance command.');
  }

  const result = await runCommand(spec);
  return {
    action,
    status: result.exitCode === 0 ? 'success' : 'failed',
    ...result,
  };
};
