jest.mock('../../models/UserHomePreference.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../services/homeQuickActionService.js', () => ({
  resolveHomeQuickActionVisibility: jest.fn(),
}));

import type { Response } from 'express';
import UserHomePreference from '../../models/UserHomePreference';
import { resolveHomeQuickActionVisibility } from '../../services/homeQuickActionService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { getHomePreference } from '../homePreferenceController';

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

describe('home preference shortcut audience resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a null visibility map when audience resolution fails', async () => {
    (UserHomePreference.findOne as jest.Mock).mockResolvedValue(null);
    (resolveHomeQuickActionVisibility as jest.Mock).mockRejectedValue(
      new Error('shortcut configuration unavailable'),
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = {
      authContext: {
        id: 28,
        userTypeId: 3,
        roleSlug: 'assistant-manager',
        shiftRoleIds: [2, 7],
      },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await getHomePreference(request, response);

    expect(response.json).toHaveBeenCalledWith({
      preference: {
        viewMode: 'navigation',
        savedDashboardIds: [],
        activeDashboardId: null,
        quickActionVisibility: null,
      },
    });
    expect(response.status).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
