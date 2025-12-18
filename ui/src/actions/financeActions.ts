import { createAsyncThunk } from '@reduxjs/toolkit';
import type { AxiosProgressEvent } from 'axios';
import axiosInstance from '../utils/axiosInstance';
import {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceClient,
  FinanceFile,
  FinanceManagementRequest,
  FinanceRecurringRule,
  FinanceTransaction,
  FinanceTransactionListResponse,
  FinanceVendor,
} from '../types/finance';

const FINANCE_BASE = '/finance';

function buildFinanceUrl(path: string): string {
  return `${FINANCE_BASE}${path}`;
}

const withCredentials = { withCredentials: true as const };

// Accounts
export const fetchFinanceAccounts = createAsyncThunk<FinanceAccount[]>(
  'finance/accounts/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceAccount[]>(buildFinanceUrl('/accounts'), withCredentials);
    return response.data;
  },
);

export const createFinanceAccount = createAsyncThunk<FinanceAccount, Partial<FinanceAccount>>(
  'finance/accounts/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceAccount>(buildFinanceUrl('/accounts'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceAccount = createAsyncThunk<FinanceAccount, { id: number; changes: Partial<FinanceAccount> }>(
  'finance/accounts/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceAccount>(buildFinanceUrl(`/accounts/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceAccount = createAsyncThunk<number, number>(
  'finance/accounts/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/accounts/${id}`), withCredentials);
    return id;
  },
);

// Categories
export const fetchFinanceCategories = createAsyncThunk<FinanceCategory[]>(
  'finance/categories/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceCategory[]>(buildFinanceUrl('/categories'), withCredentials);
    return response.data;
  },
);

export const createFinanceCategory = createAsyncThunk<FinanceCategory, Partial<FinanceCategory>>(
  'finance/categories/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceCategory>(buildFinanceUrl('/categories'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceCategory = createAsyncThunk<FinanceCategory, { id: number; changes: Partial<FinanceCategory> }>(
  'finance/categories/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceCategory>(buildFinanceUrl(`/categories/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceCategory = createAsyncThunk<number, number>(
  'finance/categories/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/categories/${id}`), withCredentials);
    return id;
  },
);

// Vendors
export const fetchFinanceVendors = createAsyncThunk<FinanceVendor[]>(
  'finance/vendors/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceVendor[]>(buildFinanceUrl('/vendors'), withCredentials);
    return response.data;
  },
);

export const createFinanceVendor = createAsyncThunk<FinanceVendor, Partial<FinanceVendor>>(
  'finance/vendors/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceVendor>(buildFinanceUrl('/vendors'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceVendor = createAsyncThunk<FinanceVendor, { id: number; changes: Partial<FinanceVendor> }>(
  'finance/vendors/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceVendor>(buildFinanceUrl(`/vendors/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceVendor = createAsyncThunk<number, number>(
  'finance/vendors/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/vendors/${id}`), withCredentials);
    return id;
  },
);

// Clients
export const fetchFinanceClients = createAsyncThunk<FinanceClient[]>(
  'finance/clients/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceClient[]>(buildFinanceUrl('/clients'), withCredentials);
    return response.data;
  },
);

export const createFinanceClient = createAsyncThunk<FinanceClient, Partial<FinanceClient>>(
  'finance/clients/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceClient>(buildFinanceUrl('/clients'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceClient = createAsyncThunk<FinanceClient, { id: number; changes: Partial<FinanceClient> }>(
  'finance/clients/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceClient>(buildFinanceUrl(`/clients/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceClient = createAsyncThunk<number, number>(
  'finance/clients/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/clients/${id}`), withCredentials);
    return id;
  },
);

// Transactions
type FetchTransactionsParams = Partial<{
  status: string;
  kind: string;
  accountId: number;
  categoryId: number;
  counterpartyId: number;
  counterpartyType: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
  offset: number;
}>;

export const fetchFinanceTransactions = createAsyncThunk<FinanceTransactionListResponse, FetchTransactionsParams | undefined>(
  'finance/transactions/fetch',
  async (params) => {
    const response = await axiosInstance.get<FinanceTransactionListResponse>(
      buildFinanceUrl('/transactions'),
      {
        ...withCredentials,
        params,
      },
    );
    return response.data;
  },
);

export const createFinanceTransaction = createAsyncThunk<FinanceTransaction, Partial<FinanceTransaction>>(
  'finance/transactions/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceTransaction>(buildFinanceUrl('/transactions'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceTransaction = createAsyncThunk<FinanceTransaction, { id: number; changes: Partial<FinanceTransaction> }>(
  'finance/transactions/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceTransaction>(buildFinanceUrl(`/transactions/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceTransaction = createAsyncThunk<number, number>(
  'finance/transactions/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/transactions/${id}`), withCredentials);
    return id;
  },
);

export const createFinanceTransfer = createAsyncThunk<
  { debit: FinanceTransaction; credit: FinanceTransaction },
  {
    fromAccountId: number;
    toAccountId: number;
    amountMinor: number;
    currency: string;
    fxRate?: number | string;
    description?: string | null;
    tags?: Record<string, unknown> | null;
    meta?: Record<string, unknown> | null;
    status?: string;
    date: string;
  }
>(
  'finance/transactions/createTransfer',
  async (payload) => {
    const response = await axiosInstance.post<{ debit: FinanceTransaction; credit: FinanceTransaction }>(
      buildFinanceUrl('/transfers'),
      payload,
      withCredentials,
    );
    return response.data;
  },
);

// Recurring rules
export const fetchFinanceRecurringRules = createAsyncThunk<FinanceRecurringRule[]>(
  'finance/recurring/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceRecurringRule[]>(buildFinanceUrl('/recurring-rules'), withCredentials);
    return response.data;
  },
);

export const createFinanceRecurringRule = createAsyncThunk<FinanceRecurringRule, Partial<FinanceRecurringRule>>(
  'finance/recurring/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceRecurringRule>(buildFinanceUrl('/recurring-rules'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceRecurringRule = createAsyncThunk<FinanceRecurringRule, { id: number; changes: Partial<FinanceRecurringRule> }>(
  'finance/recurring/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceRecurringRule>(buildFinanceUrl(`/recurring-rules/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceRecurringRule = createAsyncThunk<number, number>(
  'finance/recurring/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/recurring-rules/${id}`), withCredentials);
    return id;
  },
);

export const executeFinanceRecurringRules = createAsyncThunk<{ processed: number; createdTransactions: number; skipped: number }>(
  'finance/recurring/execute',
  async () => {
    const response = await axiosInstance.post<{ processed: number; createdTransactions: number; skipped: number }>(
      buildFinanceUrl('/recurring-runs/execute'),
      {},
      withCredentials,
    );
    return response.data;
  },
);

// Budgets
export const fetchFinanceBudgets = createAsyncThunk<FinanceBudget[]>(
  'finance/budgets/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceBudget[]>(buildFinanceUrl('/budgets'), withCredentials);
    return response.data;
  },
);

export const createFinanceBudget = createAsyncThunk<FinanceBudget, Partial<FinanceBudget>>(
  'finance/budgets/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceBudget>(buildFinanceUrl('/budgets'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceBudget = createAsyncThunk<FinanceBudget, { id: number; changes: Partial<FinanceBudget> }>(
  'finance/budgets/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceBudget>(buildFinanceUrl(`/budgets/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const deleteFinanceBudget = createAsyncThunk<number, number>(
  'finance/budgets/delete',
  async (id) => {
    await axiosInstance.delete(buildFinanceUrl(`/budgets/${id}`), withCredentials);
    return id;
  },
);

// Management requests
export const fetchFinanceManagementRequests = createAsyncThunk<FinanceManagementRequest[]>(
  'finance/managementRequests/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceManagementRequest[]>(buildFinanceUrl('/management-requests'), withCredentials);
    return response.data;
  },
);

export const createFinanceManagementRequest = createAsyncThunk<FinanceManagementRequest, Partial<FinanceManagementRequest>>(
  'finance/managementRequests/create',
  async (payload) => {
    const response = await axiosInstance.post<FinanceManagementRequest>(buildFinanceUrl('/management-requests'), payload, withCredentials);
    return response.data;
  },
);

export const updateFinanceManagementRequest = createAsyncThunk<FinanceManagementRequest, { id: number; changes: Partial<FinanceManagementRequest> }>(
  'finance/managementRequests/update',
  async ({ id, changes }) => {
    const response = await axiosInstance.put<FinanceManagementRequest>(buildFinanceUrl(`/management-requests/${id}`), changes, withCredentials);
    return response.data;
  },
);

export const approveFinanceManagementRequest = createAsyncThunk<FinanceManagementRequest, { id: number; decisionNote?: string | null }>(
  'finance/managementRequests/approve',
  async ({ id, decisionNote }) => {
    const response = await axiosInstance.post<FinanceManagementRequest>(
      buildFinanceUrl(`/management-requests/${id}/approve`),
      { decisionNote },
      withCredentials,
    );
    return response.data;
  },
);

export const returnFinanceManagementRequest = createAsyncThunk<FinanceManagementRequest, { id: number; decisionNote?: string | null }>(
  'finance/managementRequests/return',
  async ({ id, decisionNote }) => {
    const response = await axiosInstance.post<FinanceManagementRequest>(
      buildFinanceUrl(`/management-requests/${id}/return`),
      { decisionNote },
      withCredentials,
    );
    return response.data;
  },
);

export const rejectFinanceManagementRequest = createAsyncThunk<FinanceManagementRequest, { id: number; decisionNote?: string | null }>(
  'finance/managementRequests/reject',
  async ({ id, decisionNote }) => {
    const response = await axiosInstance.post<FinanceManagementRequest>(
      buildFinanceUrl(`/management-requests/${id}/reject`),
      { decisionNote },
      withCredentials,
    );
    return response.data;
  },
);

// Files
export const fetchFinanceFiles = createAsyncThunk<FinanceFile[]>(
  'finance/files/fetch',
  async () => {
    const response = await axiosInstance.get<FinanceFile[]>(buildFinanceUrl('/files'), withCredentials);
    return response.data;
  },
);

type UploadFinanceFilePayload = {
  formData: FormData;
  onUploadProgress?: (percent: number) => void;
};

export const uploadFinanceFile = createAsyncThunk<FinanceFile, UploadFinanceFilePayload>(
  'finance/files/upload',
  async ({ formData, onUploadProgress }) => {
    const response = await axiosInstance.post<FinanceFile>(buildFinanceUrl('/files'), formData, {
      withCredentials: true,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (!onUploadProgress) {
          return;
        }
        if (typeof event.total === 'number' && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onUploadProgress(percent);
        }
      },
    });
    return response.data;
  },
);
