import axiosInstance from '../utils/axiosInstance';
import {
  bulkUpdateAmTaskTemplateOptions,
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
    patch: jest.fn(),
  },
}));

const mockedPatch = axiosInstance.patch as jest.Mock;

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
