import { fetchFinanceTransactions } from '../actions/financeActions';
import type { FinanceTransaction, FinanceTransactionListResponse } from '../types/finance';
import financeReducer from './financeReducer';

jest.mock('../utils/axiosInstance', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const transaction = (id: number): FinanceTransaction => ({ id } as FinanceTransaction);

const response = (
  id: number,
  meta: FinanceTransactionListResponse['meta'],
): FinanceTransactionListResponse => ({
  data: [transaction(id)],
  meta,
});

describe('financeReducer transaction request ordering', () => {
  it('ignores an older fulfilled response after a newer request has started', () => {
    const firstParams = { limit: 100, offset: 0 };
    const secondParams = { limit: 100, offset: 100, status: 'paid' };

    let state = financeReducer(undefined, fetchFinanceTransactions.pending('first-request', firstParams));
    state = financeReducer(state, fetchFinanceTransactions.pending('second-request', secondParams));
    state = financeReducer(
      state,
      fetchFinanceTransactions.fulfilled(
        response(1, { count: 250, limit: 100, offset: 0 }),
        'first-request',
        firstParams,
      ),
    );

    expect(state.transactions).toMatchObject({
      activeRequestId: 'second-request',
      loading: true,
      error: null,
      data: [],
      meta: { count: 0, limit: 50, offset: 0 },
    });

    state = financeReducer(
      state,
      fetchFinanceTransactions.fulfilled(
        response(202, { count: 250, limit: 100, offset: 100 }),
        'second-request',
        secondParams,
      ),
    );

    expect(state.transactions).toMatchObject({
      activeRequestId: null,
      loading: false,
      error: null,
      data: [{ id: 202 }],
      meta: { count: 250, limit: 100, offset: 100 },
    });
  });

  it('ignores an older rejection while the latest request is still pending', () => {
    const firstParams = { limit: 10, offset: 0 };
    const secondParams = { limit: 10, offset: 10 };

    let state = financeReducer(undefined, fetchFinanceTransactions.pending('first-request', firstParams));
    state = financeReducer(state, fetchFinanceTransactions.pending('second-request', secondParams));
    state = financeReducer(
      state,
      fetchFinanceTransactions.rejected(
        new Error('The old request failed'),
        'first-request',
        firstParams,
      ),
    );

    expect(state.transactions).toMatchObject({
      activeRequestId: 'second-request',
      loading: true,
      error: null,
    });
  });
});
