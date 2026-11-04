import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { systemdWorkerLaunch, linuxProcessStart } from './workerLaunch.js';
import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import logger from '../../utils/logger.js';

// The child uses the activated backend's compiled script and dependency layer.
// It cannot drift onto a different checkout/release, and it has a separate heap.
// External supervisors can opt out through a bootstrap environment setting.
export function startWorkspaceSupervisor(): () => void {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.DB_WORKSPACE_EXTERNAL_WORKER === 'true'
  )
    return () => {};
  let child: ChildProcess | undefined,
    stopping = false,
    checking = false,
    nextStart = 0,
    failures = 0;
  let unitName = '',
    resourceHash = '',
    stoppingUnit = false;
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../scripts/databaseWorkspaceWorker.js',
  );
  const stopChild = () => {
    if (!child || !unitName || stoppingUnit) return;
    stoppingUnit = true;
    const stopper = spawn('/usr/bin/systemctl', ['stop', unitName], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const deadline = setTimeout(() => stopper.kill('SIGKILL'), 10000);
    deadline.unref();
    stopper.on('error', () => {});
    stopper.on('exit', () => clearTimeout(deadline));
  };
  const check = async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      await refreshConfigCacheKeys([
        'DB_WORKSPACE_ENABLED',
        'DB_WORKSPACE_WORKER_MEMORY_MB',
        'DB_WORKSPACE_WORKER_CPU_PERCENT',
        'DB_WORKSPACE_ARTIFACT_DIRECTORY',
        'DB_BACKUP_DIRECTORY',
      ]);
      const enabled =
        getConfigValue('DB_WORKSPACE_ENABLED') === true &&
        Boolean(process.env.DB_WORKSPACE_CONTROL_URL);
      if (!enabled) {
        stopChild();
        return;
      }
      const memoryMb = Number(getConfigValue('DB_WORKSPACE_WORKER_MEMORY_MB')),
        cpuPercent = Number(getConfigValue('DB_WORKSPACE_WORKER_CPU_PERCENT')),
        artifactDirectory = String(
          getConfigValue('DB_WORKSPACE_ARTIFACT_DIRECTORY'),
        );
      const configuredBackups = String(
        getConfigValue('DB_BACKUP_DIRECTORY') || '',
      );
      if (configuredBackups && !path.isAbsolute(configuredBackups))
        throw new Error(
          'The worker requires an absolute server backup directory.',
        );
      const backupDirectory =
        configuredBackups && fs.existsSync(configuredBackups)
          ? fs.realpathSync(configuredBackups)
          : undefined;
      const desired = JSON.stringify({
        memoryMb,
        cpuPercent,
        artifactDirectory,
        backupDirectory,
      });
      if (child) {
        if (resourceHash !== desired) stopChild();
        return;
      }
      if (Date.now() < nextStart) return;
      const parentStart = linuxProcessStart(
        fs.readFileSync('/proc/self/stat', 'utf8'),
      );
      unitName = `omnilodge-workspace-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      const launch = systemdWorkerLaunch({
        pid: process.pid,
        parentStart,
        unit: unitName,
        script,
        cwd: process.cwd(),
        memoryMb,
        cpuPercent,
        artifactDirectory,
        backupDirectory,
      });
      fs.mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
      resourceHash = desired;
      stoppingUnit = false;
      child = spawn(launch.executable, launch.args, {
        stdio: 'ignore',
        windowsHide: true,
      });
      const running = child;
      logger.info('[database-workspace] Starting isolated execution worker');
      running.on('error', () => {
        logger.error('[database-workspace] Execution worker could not start');
      });
      running.on('exit', (code, signal) => {
        if (child === running) child = undefined;
        failures = code === 0 ? 0 : Math.min(failures + 1, 6);
        nextStart = Date.now() + Math.min(60000, 1000 * 2 ** failures);
        logger.info('[database-workspace] Execution worker exited', {
          code,
          signal,
        });
      });
    } catch {
      logger.warn(
        '[database-workspace] Worker supervision configuration unavailable',
      );
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), 5000);
  timer.unref();
  void check();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    stopChild();
  };
  const shutdown = () => {
    stop();
    const exit = setTimeout(() => process.exit(0), 9000);
    exit.unref();
    if (!child) process.exit(0);
    else child.once('exit', () => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('exit', () => {
    child?.kill('SIGKILL');
  });
  return stop;
}
