import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
  },
}));

import { hasModuleActionPermission } from '../authorizationMiddleware';

const permissionModel = jest.requireMock('../../__mocks__/sequelizeModelStub').default as {
  findAll: jest.Mock;
};

const createRequest = (
  userTypeId: number | null = 6,
  permissionCache?: Map<string, Set<string>>,
): AuthenticatedRequest =>
  ({
    authContext: {
      id: 91,
      userTypeId,
      roleSlug: 'manager',
    },
    permissionCache,
  } as unknown as AuthenticatedRequest);

describe('hasModuleActionPermission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false without querying when authentication context is missing', async () => {
    const req = {} as AuthenticatedRequest;

    await expect(
      hasModuleActionPermission(req, 'user-directory', 'view'),
    ).resolves.toBe(false);
    expect(permissionModel.findAll).not.toHaveBeenCalled();
  });

  it('returns false without querying when the user has no user type', async () => {
    const req = createRequest(null);

    await expect(
      hasModuleActionPermission(req, 'user-directory', 'view'),
    ).resolves.toBe(false);
    expect(permissionModel.findAll).not.toHaveBeenCalled();
  });

  it('uses an existing request permission cache', async () => {
    const req = createRequest(
      6,
      new Map([
        ['user-directory', new Set(['view'])],
      ]),
    );

    await expect(
      hasModuleActionPermission(req, 'user-directory', 'view'),
    ).resolves.toBe(true);
    await expect(
      hasModuleActionPermission(req, 'user-directory', 'update'),
    ).resolves.toBe(false);
    expect(permissionModel.findAll).not.toHaveBeenCalled();
  });

  it('builds and reuses a permission cache from active allowed records', async () => {
    permissionModel.findAll.mockResolvedValue([
      {
        module: { slug: 'user-directory', status: true },
        action: { key: 'view' },
      },
      {
        module: { slug: 'user-directory', status: true },
        action: { key: 'update' },
      },
      {
        module: { slug: 'disabled-module', status: false },
        action: { key: 'view' },
      },
      {
        module: null,
        action: { key: 'view' },
      },
    ]);
    const req = createRequest();

    await expect(
      hasModuleActionPermission(req, 'user-directory', 'view'),
    ).resolves.toBe(true);
    await expect(
      hasModuleActionPermission(req, 'user-directory', 'update'),
    ).resolves.toBe(true);
    await expect(
      hasModuleActionPermission(req, 'disabled-module', 'view'),
    ).resolves.toBe(false);

    expect(permissionModel.findAll).toHaveBeenCalledTimes(1);
    expect(permissionModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userTypeId: 6, allowed: true, status: true },
      }),
    );
    expect(req.permissionCache?.get('user-directory')).toEqual(
      new Set(['view', 'update']),
    );
  });
});
