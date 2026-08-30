import type { Response } from 'express';
import FinanceAccount from '../../finance/models/FinanceAccount';
import FinanceCategory from '../../finance/models/FinanceCategory';
import FinanceVendor from '../../finance/models/FinanceVendor';
import CompensationComponent from '../../models/CompensationComponent';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { getCommissionByDateRange } from '../reportController';
import { getStaffPayoutBootstrap } from '../staffPayoutBootstrapController';

jest.mock('../reportController.js', () => ({
  getCommissionByDateRange: jest.fn(),
}));
jest.mock('../../finance/models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../finance/models/FinanceCategory.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../finance/models/FinanceVendor.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/CompensationComponent.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

const mockedReport = getCommissionByDateRange as jest.Mock;
const mockedAccounts = FinanceAccount.findAll as jest.Mock;
const mockedCategories = FinanceCategory.findAll as jest.Mock;
const mockedVendors = FinanceVendor.findAll as jest.Mock;
const mockedComponents = CompensationComponent.findAll as jest.Mock;

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
  };
};

const setReportResponse = (payload: unknown) => {
  mockedReport.mockImplementation(async (_req: AuthenticatedRequest, res: Response) => {
    res.status(200).json(payload);
  });
};

describe('getStaffPayoutBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAccounts.mockResolvedValue([]);
    mockedCategories.mockResolvedValue([]);
    mockedVendors.mockResolvedValue([]);
    mockedComponents.mockResolvedValue([]);
  });

  it('loads the report and management reference data in one full-access response', async () => {
    const pays = [{ data: [{ userId: 7 }], columns: [] }];
    setReportResponse(pays);
    const req = {
      query: { startDate: '2026-08-01', endDate: '2026-08-31' },
      authContext: { id: 1, userTypeId: 1, roleSlug: 'manager' },
      staffPayoutAccessScope: 'all',
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await getStaffPayoutBootstrap(req, res);

    expect(mockedReport).toHaveBeenCalledTimes(1);
    expect(mockedAccounts).toHaveBeenCalledTimes(1);
    expect(mockedCategories).toHaveBeenCalledTimes(1);
    expect(mockedVendors).toHaveBeenCalledTimes(1);
    expect(mockedComponents).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith([{
      data: {
        pays,
        scope: 'all',
        canManagePayouts: true,
        finance: { accounts: [], categories: [], vendors: [] },
        compensationComponents: [],
      },
      columns: [],
    }]);
  });

  it('forces a self-only report and omits protected reference data', async () => {
    const pays = [{
      data: [{
        userId: 7,
        settlementSources: [{ sourceKey: 'reviews', settlementIntent: 'signed-secret' }],
      }],
      columns: [],
    }];
    setReportResponse(pays);
    const req = {
      query: { startDate: '2026-08-01', endDate: '2026-08-31', scope: 'all' },
      authContext: { id: 7, userTypeId: 9, roleSlug: 'assistant-manager' },
      staffPayoutAccessScope: 'self',
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await getStaffPayoutBootstrap(req, res);

    const reportRequest = mockedReport.mock.calls[0][0] as AuthenticatedRequest;
    expect(reportRequest.query.scope).toBe('self');
    expect(mockedAccounts).not.toHaveBeenCalled();
    expect(mockedCategories).not.toHaveBeenCalled();
    expect(mockedVendors).not.toHaveBeenCalled();
    expect(mockedComponents).not.toHaveBeenCalled();
    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload[0].data.finance).toBeNull();
    expect(responsePayload[0].data.compensationComponents).toBeNull();
    expect(responsePayload[0].data.pays[0].data[0].settlementSources[0].settlementIntent).toBeNull();
  });

  it('rejects invalid dates before loading the report or reference data', async () => {
    const req = {
      query: { startDate: '2026-08-31', endDate: '2026-08-01' },
      authContext: { id: 1, userTypeId: 1, roleSlug: 'owner' },
      staffPayoutAccessScope: 'all',
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await getStaffPayoutBootstrap(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedReport).not.toHaveBeenCalled();
    expect(mockedAccounts).not.toHaveBeenCalled();
  });
});
