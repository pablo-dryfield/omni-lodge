import type { WorkspaceStore } from './store.js';
import {
  type JobPayload,
  type JobRecord,
  errorInfo,
  WorkspaceError,
} from './types.js';

export async function runBackupDeletion(
  store: WorkspaceStore,
  job: JobRecord,
  payload: JobPayload,
  authorize: () => Promise<void>,
): Promise<void> {
  const copy = payload.backupDeletion!;
  let submitted = false;
  const timer = setInterval(() => {
    void store.heartbeat(job.id, job.workerId!, job.generation).catch(() => {});
  }, 1000);
  timer.unref();
  try {
    await authorize();
    const state = await store.heartbeat(job.id, job.workerId!, job.generation);
    if (!state || state.status === 'cancel_requested')
      throw new WorkspaceError(
        409,
        'CANCELLED',
        'Backup deletion cancelled before submission.',
      );
    const { findBackupCopy, deleteBackupCopy } = await import(
      '../dbBackupService.js'
    );
    await findBackupCopy(copy.copyId, copy.fingerprint);
    await authorize();
    submitted = true;
    await deleteBackupCopy(copy.copyId, copy.fingerprint, copy.permanent);
    const sql = `${copy.location === 'local' || copy.permanent ? 'Deleted' : 'Moved to Drive trash'} ${copy.location === 'local' ? 'server' : 'Google Drive'} copy: ${copy.filename}. Other copies were not removed.`;
    await store.finish(job, 'succeeded', 'not_applicable', [
      {
        index: 0,
        sql,
        sourceStart: 0,
        sourceEnd: 0,
        kind: 'backup-delete',
        durationMs: 0,
      },
    ]);
    await store.audit(
      payload.actorId,
      'backup_copy_removed',
      {
        copyId: copy.copyId,
        filename: copy.filename,
        location: copy.location,
        permanent: copy.permanent,
        reason: payload.reason,
      },
      payload.target.id,
      job.id,
    );
  } catch (error) {
    await store
      .finish(
        job,
        submitted ? 'outcome_unknown' : 'failed',
        submitted ? 'unknown' : 'not_started',
        [],
        errorInfo(error),
      )
      .catch(() => {});
  } finally {
    clearInterval(timer);
  }
}
