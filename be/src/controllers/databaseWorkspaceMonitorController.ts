import { workspaceHandler } from './databaseWorkspaceController.js';
import { workspaceAccess } from '../services/databaseWorkspace/access.js';
import {
  workspaceConfiguration,
  targetCredential,
} from '../services/databaseWorkspace/config.js';
import { activitySnapshot } from '../services/databaseWorkspace/monitoring.js';
export const monitorSnapshot = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'monitor');
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.query.targetId || ''),
      'read',
    );
  res.json(await activitySnapshot(target, credential));
});
