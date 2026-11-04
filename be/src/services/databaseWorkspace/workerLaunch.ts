import path from 'node:path';
import { WorkspaceError } from './types.js';

export function systemdWorkerLaunch(input: {
  pid: number;
  parentStart: string;
  unit: string;
  script: string;
  cwd: string;
  memoryMb: number;
  cpuPercent: number;
  artifactDirectory: string;
  backupDirectory?: string;
}) {
  if (
    !Number.isSafeInteger(input.pid) ||
    input.pid < 1 ||
    !/^\d+$/.test(input.parentStart) ||
    !/^omnilodge-workspace-[0-9]+-[a-f0-9]{8}$/.test(input.unit) ||
    !Number.isSafeInteger(input.memoryMb) ||
    input.memoryMb < 256 ||
    input.memoryMb > 2048 ||
    !Number.isSafeInteger(input.cpuPercent) ||
    input.cpuPercent < 10 ||
    input.cpuPercent > 200
  )
    throw new WorkspaceError(
      503,
      'WORKER_POLICY',
      'Invalid bounded worker launch policy.',
    );
  for (const value of [
    input.script,
    input.cwd,
    input.artifactDirectory,
    ...(input.backupDirectory ? [input.backupDirectory] : []),
  ])
    if (
      !path.posix.isAbsolute(value) ||
      /[\u0000-\u001f$%]/.test(value) ||
      value.split('/').includes('..')
    )
      throw new WorkspaceError(
        503,
        'WORKER_PATH',
        'Worker paths must be absolute trusted paths without expansion characters.',
      );
  if (
    input.artifactDirectory.startsWith('/opt/omnilodge/releases/') ||
    input.artifactDirectory === input.cwd ||
    input.artifactDirectory.startsWith(input.cwd + '/')
  )
    throw new WorkspaceError(
      503,
      'WORKER_PATH',
      'Private artifacts must be stored outside immutable releases.',
    );
  if (
    input.backupDirectory &&
    (input.backupDirectory === '/' ||
      /^\/(?:etc|root|usr|bin|sbin|lib|proc|sys|dev|run)(?:\/|$)/.test(
        input.backupDirectory,
      ) ||
      input.backupDirectory === '/opt/omnilodge/releases' ||
      input.backupDirectory.startsWith('/opt/omnilodge/releases/'))
  )
    throw new WorkspaceError(
      503,
      'WORKER_PATH',
      'Server backups must use a dedicated data directory outside protected system and release paths.',
    );
  // This is systemd property data, not a shell command. Quote paths so spaces
  // cannot accidentally grant access to a second directory.
  const writablePaths = [
    ...new Set([
      input.artifactDirectory,
      ...(input.backupDirectory ? [input.backupDirectory] : []),
    ]),
  ]
    .map((value) => (/[\s"\\]/.test(value) ? JSON.stringify(value) : value))
    .join(' ');
  const heap = Math.max(128, Math.floor(input.memoryMb * 0.65));
  return {
    executable: '/usr/bin/systemd-run',
    args: [
      '--quiet',
      '--wait',
      '--collect',
      `--unit=${input.unit}`,
      '--property=Type=exec',
      '--property=KillMode=control-group',
      '--property=TimeoutStopSec=8s',
      `--property=MemoryMax=${input.memoryMb * 1048576}`,
      `--property=CPUQuota=${input.cpuPercent}%`,
      '--property=TasksMax=64',
      '--property=NoNewPrivileges=yes',
      '--property=PrivateTmp=yes',
      '--property=ProtectSystem=strict',
      '--property=ProtectHome=read-only',
      `--property=ReadWritePaths=${writablePaths}`,
      `--property=WorkingDirectory=${input.artifactDirectory}`,
      '--property=EnvironmentFile=/etc/omnilodge/backend.env',
      '--property=StandardOutput=null',
      '--property=StandardError=null',
      '--setenv=NODE_ENV=production',
      `--setenv=DB_WORKSPACE_PARENT_PID=${input.pid}`,
      `--setenv=DB_WORKSPACE_PARENT_START=${input.parentStart}`,
      '/usr/bin/node',
      `--max-old-space-size=${heap}`,
      '--enable-source-maps',
      input.script,
    ],
  };
}
export function linuxProcessStart(stat: string): string {
  const close = stat.lastIndexOf(')');
  const value = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/)[19];
  if (close < 0 || !/^\d+$/.test(value || ''))
    throw new WorkspaceError(
      503,
      'WORKER_PARENT',
      'Cannot verify the parent process identity.',
    );
  return value;
}
export function sameLinuxParent(
  pid: number,
  start: string,
  read: (file: string) => string,
): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(start))
    return false;
  try {
    return linuxProcessStart(read(`/proc/${pid}/stat`)) === start;
  } catch {
    return false;
  }
}
export function linuxWorkerLimits(
  cgroups: string,
  read: (file: string) => string,
): { memoryBytes: number; cpuPercent: number; tasks: number } {
  const lines = cgroups
    .trim()
    .split('\n')
    .map((line) => line.split(':'));
  const safePath = (value: string) => {
    if (!value.startsWith('/') || value.split('/').includes('..'))
      throw new WorkspaceError(
        503,
        'WORKER_ISOLATION',
        'Invalid control-group identity.',
      );
    return value;
  };
  const number = (value: string) => {
    const n = Number(value.trim());
    if (!Number.isFinite(n) || n <= 0)
      throw new WorkspaceError(
        503,
        'WORKER_ISOLATION',
        'Execution worker resource controller is unbounded.',
      );
    return n;
  };
  const unified = lines.find((line) => line[0] === '0' && line[1] === '');
  // Hybrid hosts expose an empty v2 tree plus real v1 resource controllers.
  // Prefer those explicit controllers rather than mistaking the v2 mount for
  // proof that memory/cpu are enforced there.
  if (unified && !lines.some((line) => line[1].split(',').includes('memory'))) {
    const root = '/sys/fs/cgroup' + safePath(unified[2]);
    const [quota, period] = read(root + '/cpu.max')
      .trim()
      .split(/\s+/);
    return {
      memoryBytes: number(read(root + '/memory.max')),
      cpuPercent: (number(quota) / number(period)) * 100,
      tasks: number(read(root + '/pids.max')),
    };
  }
  const location = (controller: string) => {
    const row = lines.find((line) => line[1].split(',').includes(controller));
    if (!row)
      throw new WorkspaceError(
        503,
        'WORKER_ISOLATION',
        'A required execution worker resource controller is unavailable.',
      );
    return (
      '/sys/fs/cgroup/' +
      (controller === 'cpu' ? 'cpu,cpuacct' : controller) +
      safePath(row[2])
    );
  };
  return {
    memoryBytes: number(read(location('memory') + '/memory.limit_in_bytes')),
    cpuPercent:
      (number(read(location('cpu') + '/cpu.cfs_quota_us')) /
        number(read(location('cpu') + '/cpu.cfs_period_us'))) *
      100,
    tasks: number(read(location('pids') + '/pids.max')),
  };
}
