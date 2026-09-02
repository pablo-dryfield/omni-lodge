import axiosInstance from '../utils/axiosInstance';
import {
  bulkUpdateAmTaskTemplateOptions,
  fetchAmTaskPlannerBootstrap,
  updateManagedAmTaskLog,
} from './assistantManagerTaskActions';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    isAxiosError: jest.fn(() => false),
  },
}));

jest.mock('../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;
const mockedPatch = axiosInstance.patch as jest.Mock;

describe('fetchAmTaskPlannerBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shares one credentials-enabled GET between identical concurrent calls', async () => {
    const bootstrapData = {
      range: {
        startDate: '2026-08-24',
        endDate: '2026-08-30',
      },
      capabilities: {
        canViewAllTasks: true,
      },
      templates: [],
      logs: [],
      referenceData: {
        activeUsers: [],
        userTypes: [],
        shiftRoles: [],
        shiftTypes: [],
        shiftTemplates: [],
        cerebroLinkOptions: {
          knowledgeEntries: [],
          policyEntries: [],
          quizzes: [],
        },
      },
      plannerStartDate: null,
      pushConfig: {
        enabled: false,
        publicKey: null,
      },
      warnings: [],
    };
    let resolveRequest: (value: { data: unknown }) => void = () => undefined;
    mockedGet.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const params = {
      startDate: '2026-08-24',
      endDate: '2026-08-30',
      scope: 'all' as const,
      windowMode: 'week' as const,
    };

    const firstRequest = fetchAmTaskPlannerBootstrap(params)(jest.fn(), jest.fn(), undefined);
    const secondRequest = fetchAmTaskPlannerBootstrap(params)(jest.fn(), jest.fn(), undefined);

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      '/assistantManagerTasks/bootstrap?startDate=2026-08-24&endDate=2026-08-30&scope=all&windowMode=week',
      { withCredentials: true },
    );

    resolveRequest({ data: [{ data: bootstrapData, columns: [] }] });
    const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);

    expect(firstResult.type).toBe('assistantManagerTasks/fetchPlannerBootstrap/fulfilled');
    expect(secondResult.type).toBe('assistantManagerTasks/fetchPlannerBootstrap/fulfilled');
    expect(firstResult.payload).toEqual(bootstrapData);
    expect(secondResult.payload).toEqual(bootstrapData);
  });
});

describe('bulkUpdateAmTaskTemplateOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the bulk-options PATCH endpoint and preserves explicit false and remove values', async () => {
    mockedPatch.mockResolvedValue({ data: [{ data: [], columns: [] }] });
    const dispatch = jest.fn();

    const result = await bulkUpdateAmTaskTemplateOptions({
      templateIds: [7, 11],
      options: {
        requireShift: false,
        completeOnSocialMediaPublish: true,
        notifyAtStart: false,
        requiredShiftTemplateIds: [],
        scheduledWorkdayPlacement: 'end',
      },
    })(dispatch, jest.fn(), undefined);

    expect(mockedPatch).toHaveBeenCalledWith(
      '/assistantManagerTasks/templates/bulk-options',
      {
        templateIds: [7, 11],
        options: {
          requireShift: false,
          completeOnSocialMediaPublish: true,
          notifyAtStart: false,
          requiredShiftTemplateIds: [],
          scheduledWorkdayPlacement: 'end',
        },
      },
      { withCredentials: true },
    );
    expect(result.type).toBe('assistantManagerTasks/bulkUpdateTemplateOptions/fulfilled');
  });
});

describe('updateManagedAmTaskLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the manager-only task edit endpoint with the complete task-instance payload', async () => {
    mockedPatch.mockResolvedValue({ data: [{ data: [], columns: [] }] });
    const dispatch = jest.fn();
    const payload = {
      userId: 12,
      taskDate: '2026-08-26',
      time: '10:30',
      durationHours: 1.5,
      priority: 'high' as const,
      points: 3,
      tags: ['weekly', 'cleaning'],
      notes: 'Use the downstairs storage room.',
      requireShift: false,
    };

    const result = await updateManagedAmTaskLog({ logId: 77, payload })(
      dispatch,
      jest.fn(),
      undefined,
    );

    expect(mockedPatch).toHaveBeenCalledWith(
      '/assistantManagerTasks/logs/77/manage',
      payload,
      { withCredentials: true },
    );
    expect(result.type).toBe('assistantManagerTasks/updateManagedLog/fulfilled');
  });
});
