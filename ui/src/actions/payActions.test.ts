import axiosInstance from '../utils/axiosInstance';
import { fetchPays } from './payActions';

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
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;

describe('fetchPays', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shares one bootstrap request and returns the authorized page reference data', async () => {
    let resolveRequest: (value: { data: unknown }) => void = () => undefined;
    mockedGet.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const params = {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      scope: 'all' as const,
    };
    const dispatch = jest.fn();

    const firstRequest = fetchPays(params)(dispatch, jest.fn(), undefined);
    const secondRequest = fetchPays(params)(dispatch, jest.fn(), undefined);

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      '/reports/staffPayouts/bootstrap?startDate=2026-08-01&endDate=2026-08-31',
      { withCredentials: true },
    );

    const bootstrap = {
          pays: [{ data: [], columns: [] }],
          scope: 'all',
          canManagePayouts: true,
          finance: {
            accounts: [{ id: 1, name: 'Cash', type: 'cash', currency: 'PLN', isActive: true }],
            categories: [{ id: 2, name: 'Payroll', kind: 'expense', parentId: null, isActive: true }],
            vendors: [{ id: 3, name: 'Staff Vendor', defaultCategoryId: 2, isActive: true }],
          },
          compensationComponents: [],
        };
    resolveRequest({
      data: [{
        data: bootstrap,
        columns: [],
      }],
    });

    const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);
    expect(firstResult.type).toBe('pay/pay/fulfilled');
    expect(secondResult.type).toBe('pay/pay/fulfilled');
    expect(firstResult.payload).toEqual(bootstrap);
    expect(secondResult.payload).toEqual(bootstrap);
  });

  it('keeps protected reference data absent for a self-only response', async () => {
    mockedGet.mockResolvedValue({
      data: [{
        data: {
          pays: [{ data: [], columns: [] }],
          scope: 'self',
          canManagePayouts: false,
          finance: null,
          compensationComponents: null,
        },
        columns: [],
      }],
    });
    const dispatch = jest.fn();

    const result = await fetchPays({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      scope: 'self',
    })(dispatch, jest.fn(), undefined);

    expect(result.type).toBe('pay/pay/fulfilled');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(result.payload).toEqual({
      pays: [{ data: [], columns: [] }],
      scope: 'self',
      canManagePayouts: false,
      finance: null,
      compensationComponents: null,
    });
  });
});
