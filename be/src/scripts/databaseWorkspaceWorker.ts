import 'reflect-metadata';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import fs from 'node:fs';
import {
  linuxProcessStart,
  linuxWorkerLimits,
} from '../services/databaseWorkspace/workerLaunch.js';

process.env.OMNILODGE_WORKSPACE_WORKER = 'true';

dotenv.config({
  path: path.resolve(
    process.cwd(),
    process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
  ),
});
const { controlStore } = await import('../services/databaseWorkspace/store.js');
const { runJob } = await import('../services/databaseWorkspace/runner.js');
const { reauthorizeExecution } = await import(
  '../services/databaseWorkspace/access.js'
);
const { cleanupArtifacts } = await import(
  '../services/databaseWorkspace/artifacts.js'
);
const { reconcileOrphans } = await import(
  '../services/databaseWorkspace/resultAccess.js'
);
const { SessionEngine } = await import(
  '../services/databaseWorkspace/sessions.js'
);
const { runMaintenance } = await import(
  '../services/databaseWorkspace/maintenanceRunner.js'
);
const { workspaceConfiguration, targetCredential } = await import(
  '../services/databaseWorkspace/config.js'
);
const { initializeSchedules, dispatchSchedules } = await import(
  '../services/databaseWorkspace/schedules.js'
);
const { getConfigValue } = await import('../services/configService.js');
const { initializeRecovery, runRecovery, cleanupRecovery } = await import(
  '../services/databaseWorkspace/recovery.js'
);
const { runBackupDeletion } = await import(
  '../services/databaseWorkspace/backupRunner.js'
);
const { default: sequelize } = await import('../config/database.js');
const { defineAssociations } = await import('../models/defineAssociations.js');
defineAssociations();
await sequelize.authenticate();
const store = controlStore();
if (!(await store.healthy()))
  throw new Error('Database Workspace control store has not been provisioned.');
await store.initialize();
await initializeSchedules(store);
await initializeRecovery(store);
const workerId = crypto.randomUUID();
let stopping = false,
  lastCleanup = 0;
const resources =
  process.env.NODE_ENV === 'production'
    ? linuxWorkerLimits(fs.readFileSync('/proc/self/cgroup', 'utf8'), (file) =>
        fs.readFileSync(file, 'utf8'),
      )
    : undefined;
const heartbeatLimits = resources ? {...resources,parentPid:process.env.DB_WORKSPACE_PARENT_PID,parentStart:process.env.DB_WORKSPACE_PARENT_START} : undefined;
const verifyResources = () => {
  if (
    resources &&
    (resources.memoryBytes >
      Number(getConfigValue('DB_WORKSPACE_WORKER_MEMORY_MB')) * 1048576 ||
      resources.cpuPercent >
        Number(getConfigValue('DB_WORKSPACE_WORKER_CPU_PERCENT')) + 0.01 ||
      resources.tasks > 64)
  )
    throw new Error(
      'Execution worker resource isolation does not match its configured limits.',
    );
};
await workspaceConfiguration();
verifyResources();
await store.workerHeartbeat(workerId, heartbeatLimits);
const workerHeartbeat = setInterval(() => {
  if (process.env.DB_WORKSPACE_PARENT_PID) {
    try {
      const expected = process.env.DB_WORKSPACE_PARENT_START;
      if (
        !expected ||
        linuxProcessStart(
          fs.readFileSync(
            `/proc/${Number(process.env.DB_WORKSPACE_PARENT_PID)}/stat`,
            'utf8',
          ),
        ) !== expected
      )
        process.exit(1);
    } catch {
      process.exit(1);
    }
  }
  void store.workerHeartbeat(workerId, heartbeatLimits).catch(() => {});
}, 3000);
workerHeartbeat.unref();
const sessions = new SessionEngine(store, workerId, async (p) => {
  await reauthorizeExecution(p.actorId, p.mode, p.policyHash, 'session');
  verifyResources();
});
const sessionTimer = setInterval(() => {
  void sessions.tick().catch(() => {});
}, 500);
sessionTimer.unref();
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
console.log(
  JSON.stringify({
    component: 'database-workspace-worker',
    event: 'ready',
    workerId,
  }),
);
while (!stopping) {
  try {
    await dispatchSchedules(
      store,
      async (p, schedule) => {
        await reauthorizeExecution(p.actorId, p.mode, p.policyHash, 'schedule');
        if (schedule.documentId) {
          const document = (await store.documents(p.actorId, 'query')).find(
            (d) => d.id === schedule.documentId,
          );
          if (document?.revision !== schedule.documentRevision)
            throw new Error('Scheduled query revision changed.');
        }
      },
      Number(getConfigValue('DB_WORKSPACE_SCHEDULE_GRACE_MS') || 60000),
    );
    if (Date.now() - lastCleanup > 30000) {
      await store.expireLostLeases();
      await reconcileOrphans(store);
      await cleanupArtifacts(store);
      await cleanupRecovery(store);
      await store.retention(
        Number(getConfigValue('DB_WORKSPACE_HISTORY_RETENTION_DAYS') || 30),
        Number(getConfigValue('DB_WORKSPACE_AUDIT_RETENTION_DAYS') || 365),
      );
      lastCleanup = Date.now();
    }
    const next = await store.claim(workerId);
    if (next) {
      const authorize = async () => {
        await reauthorizeExecution(
          next.payload.actorId,
          next.payload.mode,
          next.payload.policyHash,
          next.payload.administration?.action as Parameters<
            typeof reauthorizeExecution
          >[3],
        );
        verifyResources();
      };
      if (next.payload.backupDeletion)
        await runBackupDeletion(store, next.job, next.payload, async () => {
          await authorize();
          await reauthorizeExecution(
            next.payload.actorId,
            next.payload.mode,
            next.payload.policyHash,
            'backupDelete',
          );
          await reauthorizeExecution(
            next.payload.actorId,
            next.payload.mode,
            next.payload.policyHash,
            'backup',
          );
        });
      else if (next.payload.recovery)
        await runRecovery(store, next.job, next.payload, async () => {
          await authorize();
          await reauthorizeExecution(
            next.payload.actorId,
            next.payload.mode,
            next.payload.policyHash,
            'restore',
          );
          await reauthorizeExecution(
            next.payload.actorId,
            next.payload.mode,
            next.payload.policyHash,
            'backup',
          );
        });
      else if (next.payload.administration) {
        const config = await workspaceConfiguration();
        await runMaintenance(
          store,
          next.job,
          next.payload,
          authorize,
          targetCredential(config, next.payload.target.id, 'read').credential,
        );
      } else await runJob(store, next.job, next.payload, authorize);
    } else await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    console.error(
      JSON.stringify({
        component: 'database-workspace-worker',
        event: 'iteration_failed',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
clearInterval(sessionTimer);
clearInterval(workerHeartbeat);
await sessions.shutdown();
await store.pool.query('DELETE FROM database_workspace.workers WHERE id=$1', [
  workerId,
]);
await store.close();
await sequelize.close();
