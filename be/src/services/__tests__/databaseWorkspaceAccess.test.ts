jest.mock('../databaseWorkspace/appMetadata.js', () => ({
  loadWorkspaceAccount: jest.fn(),
  loadWorkspaceAuthority: jest.fn(),
}));
jest.mock('../../models/UserTypeProductType.js', () => ({
  __esModule: true,
  default: { count: jest.fn(async () => 0) },
}));
jest.mock('../databaseWorkspace/config.js', () => ({
  workspaceConfiguration: jest.fn(async () => ({
    enabled: true,
    policyHash: 'current',
  })),
}));
import {
  workspaceAccess,
  reauthorizeExecution,
  WORKSPACE_ACTIONS,
} from '../databaseWorkspace/access';
import {
  loadWorkspaceAccount,
  loadWorkspaceAuthority,
} from '../databaseWorkspace/appMetadata';
import UserTypeProductType from '../../models/UserTypeProductType';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
const req = (roleSlug = 'admin', scoped = false) =>
  ({
    authContext: { id: 7, userTypeId: 2, roleSlug },
    ...(scoped ? { productTypeScope: [3] } : {}),
  }) as AuthenticatedRequest;
beforeEach(() => {
  jest.clearAllMocks();
  (loadWorkspaceAuthority as jest.Mock).mockResolvedValue({
    page: true,
    actions: [...WORKSPACE_ACTIONS],
  });
  (UserTypeProductType.count as jest.Mock).mockResolvedValue(0);
  (loadWorkspaceAccount as jest.Mock).mockResolvedValue({
    id: 7,
    userTypeId: 2,
    status: true,
    approved: true,
    role: { slug: 'admin', status: true },
  });
});
it.each(WORKSPACE_ACTIONS)(
  'denies %s to anonymous, business roles and product-scoped administrators',
  async (action) => {
    for (const r of [
      {} as AuthenticatedRequest,
      req('user'),
      req('manager'),
      req('owner'),
      req('food-tour-owner', true),
      req('admin', true),
    ])
      await expect(workspaceAccess(r, action)).rejects.toMatchObject({
        status: 403,
      });
    expect(loadWorkspaceAuthority).not.toHaveBeenCalled();
  },
);
it.each(['admin', 'administrator'])(
  'requires page, view and an active action grant for %s',
  async (role) => {
    await expect(workspaceAccess(req(role), 'write')).resolves.toBe(7);
    (loadWorkspaceAuthority as jest.Mock).mockResolvedValueOnce({
      page: false,
      actions: [...WORKSPACE_ACTIONS],
    });
    await expect(workspaceAccess(req(role), 'read')).rejects.toMatchObject({
      code: 'CAPABILITY_REQUIRED',
    });
    for (const missing of ['view', 'write']) {
      (loadWorkspaceAuthority as jest.Mock).mockResolvedValueOnce({
        page: true,
        actions: WORKSPACE_ACTIONS.filter((a) => a !== missing),
      });
      await expect(workspaceAccess(req(role), 'write')).rejects.toMatchObject({
        status: 403,
      });
    }
  },
);
it('only reuses a snapshot within the exact request and reads current authority on the next request', async () => {
  const r = req();
  await workspaceAccess(r, 'view');
  await workspaceAccess(r, 'read');
  expect(loadWorkspaceAuthority).toHaveBeenCalledTimes(1);
  (loadWorkspaceAuthority as jest.Mock).mockResolvedValue({
    page: false,
    actions: [],
  });
  await expect(workspaceAccess(req(), 'read')).rejects.toMatchObject({
    status: 403,
  });
  expect(loadWorkspaceAuthority).toHaveBeenCalledTimes(2);
});
it('reauthorizes current approval, role, product scope, grants and exact policy before execution', async () => {
  await expect(
    reauthorizeExecution(7, 'write', 'current'),
  ).resolves.toBeUndefined();
  await expect(reauthorizeExecution(7, 'read', 'old')).rejects.toMatchObject({
    code: 'POLICY_CHANGED',
  });
  (UserTypeProductType.count as jest.Mock).mockResolvedValue(1);
  await expect(
    reauthorizeExecution(7, 'read', 'current'),
  ).rejects.toMatchObject({ code: 'AUTHORITY_REVOKED' });
  (UserTypeProductType.count as jest.Mock).mockResolvedValue(0);
  (loadWorkspaceAccount as jest.Mock).mockResolvedValue({ status: false });
  await expect(
    reauthorizeExecution(7, 'read', 'current'),
  ).rejects.toMatchObject({ code: 'AUTHORITY_REVOKED' });
});
