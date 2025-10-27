import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  approveFinanceManagementRequest,
  createFinanceAccount,
  createFinanceBudget,
  createFinanceCategory,
  createFinanceClient,
  createFinanceManagementRequest,
  createFinanceRecurringRule,
  createFinanceTransaction,
  createFinanceTransfer,
  createFinanceVendor,
  deleteFinanceAccount,
  deleteFinanceBudget,
  deleteFinanceCategory,
  deleteFinanceClient,
  deleteFinanceRecurringRule,
  deleteFinanceTransaction,
  deleteFinanceVendor,
  executeFinanceRecurringRules,
  fetchFinanceAccounts,
  fetchFinanceBudgets,
  fetchFinanceCategories,
  fetchFinanceClients,
  fetchFinanceFiles,
  fetchFinanceManagementRequests,
  fetchFinanceRecurringRules,
  fetchFinanceTransactions,
  fetchFinanceVendors,
  rejectFinanceManagementRequest,
  returnFinanceManagementRequest,
  updateFinanceAccount,
  updateFinanceBudget,
  updateFinanceCategory,
  updateFinanceClient,
  updateFinanceManagementRequest,
  updateFinanceRecurringRule,
  updateFinanceTransaction,
  updateFinanceVendor,
  uploadFinanceFile,
} from '../actions/financeActions';
import {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceClient,
  FinanceFile,
  FinanceManagementRequest,
  FinanceRecurringRule,
  FinanceTransaction,
  FinanceVendor,
  FinanceTransactionListResponse,
} from '../types/finance';

type EntityState<T> = {
  loading: boolean;
  error: string | null;
  data: T[];
};

type TransactionState = {
  loading: boolean;
  error: string | null;
  data: FinanceTransaction[];
  meta: {
    count: number;
    limit: number;
    offset: number;
  };
};

type FileUploadState = {
  loading: boolean;
  error: string | null;
  items: FinanceFile[];
  latest?: FinanceFile | null;
};

type RecurringExecutionState = {
  loading: boolean;
  result: {
    processed: number;
    createdTransactions: number;
    skipped: number;
  } | null;
  error: string | null;
};

export type FinanceState = {
  accounts: EntityState<FinanceAccount>;
  categories: EntityState<FinanceCategory>;
  vendors: EntityState<FinanceVendor>;
  clients: EntityState<FinanceClient>;
  budgets: EntityState<FinanceBudget>;
  managementRequests: EntityState<FinanceManagementRequest>;
  recurringRules: EntityState<FinanceRecurringRule>;
  transactions: TransactionState;
  files: FileUploadState;
  recurringExecution: RecurringExecutionState;
};

function createInitialEntityState<T>(): EntityState<T> {
  return {
    loading: false,
    error: null,
    data: [],
  };
}

const initialState: FinanceState = {
  accounts: createInitialEntityState<FinanceAccount>(),
  categories: createInitialEntityState<FinanceCategory>(),
  vendors: createInitialEntityState<FinanceVendor>(),
  clients: createInitialEntityState<FinanceClient>(),
  budgets: createInitialEntityState<FinanceBudget>(),
  managementRequests: createInitialEntityState<FinanceManagementRequest>(),
  recurringRules: createInitialEntityState<FinanceRecurringRule>(),
  transactions: {
    loading: false,
    error: null,
    data: [],
    meta: { count: 0, limit: 50, offset: 0 },
  },
  files: {
    loading: false,
    error: null,
    items: [],
    latest: null,
  },
  recurringExecution: {
    loading: false,
    result: null,
    error: null,
  },
};

const financeSlice = createSlice({
  name: 'finance',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // Accounts
    builder
      .addCase(fetchFinanceAccounts.pending, (state) => {
        state.accounts.loading = true;
        state.accounts.error = null;
      })
      .addCase(fetchFinanceAccounts.fulfilled, (state, action: PayloadAction<FinanceAccount[]>) => {
        state.accounts.loading = false;
        state.accounts.data = action.payload;
      })
      .addCase(fetchFinanceAccounts.rejected, (state, action) => {
        state.accounts.loading = false;
        state.accounts.error = action.error.message ?? 'Failed to load accounts';
      })
      .addCase(createFinanceAccount.fulfilled, (state, action: PayloadAction<FinanceAccount>) => {
        state.accounts.data.push(action.payload);
      })
      .addCase(updateFinanceAccount.fulfilled, (state, action: PayloadAction<FinanceAccount>) => {
        state.accounts.data = state.accounts.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceAccount.fulfilled, (state, action: PayloadAction<number>) => {
        state.accounts.data = state.accounts.data.filter((item) => item.id !== action.payload);
      });

    // Categories
    builder
      .addCase(fetchFinanceCategories.pending, (state) => {
        state.categories.loading = true;
        state.categories.error = null;
      })
      .addCase(fetchFinanceCategories.fulfilled, (state, action: PayloadAction<FinanceCategory[]>) => {
        state.categories.loading = false;
        state.categories.data = action.payload;
      })
      .addCase(fetchFinanceCategories.rejected, (state, action) => {
        state.categories.loading = false;
        state.categories.error = action.error.message ?? 'Failed to load categories';
      })
      .addCase(createFinanceCategory.fulfilled, (state, action: PayloadAction<FinanceCategory>) => {
        state.categories.data.push(action.payload);
      })
      .addCase(updateFinanceCategory.fulfilled, (state, action: PayloadAction<FinanceCategory>) => {
        state.categories.data = state.categories.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceCategory.fulfilled, (state, action: PayloadAction<number>) => {
        state.categories.data = state.categories.data.filter((item) => item.id !== action.payload);
      });

    // Vendors
    builder
      .addCase(fetchFinanceVendors.pending, (state) => {
        state.vendors.loading = true;
        state.vendors.error = null;
      })
      .addCase(fetchFinanceVendors.fulfilled, (state, action: PayloadAction<FinanceVendor[]>) => {
        state.vendors.loading = false;
        state.vendors.data = action.payload;
      })
      .addCase(fetchFinanceVendors.rejected, (state, action) => {
        state.vendors.loading = false;
        state.vendors.error = action.error.message ?? 'Failed to load vendors';
      })
      .addCase(createFinanceVendor.fulfilled, (state, action: PayloadAction<FinanceVendor>) => {
        state.vendors.data.push(action.payload);
      })
      .addCase(updateFinanceVendor.fulfilled, (state, action: PayloadAction<FinanceVendor>) => {
        state.vendors.data = state.vendors.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceVendor.fulfilled, (state, action: PayloadAction<number>) => {
        state.vendors.data = state.vendors.data.filter((item) => item.id !== action.payload);
      });

    // Clients
    builder
      .addCase(fetchFinanceClients.pending, (state) => {
        state.clients.loading = true;
        state.clients.error = null;
      })
      .addCase(fetchFinanceClients.fulfilled, (state, action: PayloadAction<FinanceClient[]>) => {
        state.clients.loading = false;
        state.clients.data = action.payload;
      })
      .addCase(fetchFinanceClients.rejected, (state, action) => {
        state.clients.loading = false;
        state.clients.error = action.error.message ?? 'Failed to load clients';
      })
      .addCase(createFinanceClient.fulfilled, (state, action: PayloadAction<FinanceClient>) => {
        state.clients.data.push(action.payload);
      })
      .addCase(updateFinanceClient.fulfilled, (state, action: PayloadAction<FinanceClient>) => {
        state.clients.data = state.clients.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceClient.fulfilled, (state, action: PayloadAction<number>) => {
        state.clients.data = state.clients.data.filter((item) => item.id !== action.payload);
      });

    // Transactions
    builder
      .addCase(fetchFinanceTransactions.pending, (state) => {
        state.transactions.loading = true;
        state.transactions.error = null;
      })
      .addCase(fetchFinanceTransactions.fulfilled, (state, action: PayloadAction<FinanceTransactionListResponse>) => {
        state.transactions.loading = false;
        state.transactions.data = action.payload.data;
        state.transactions.meta = action.payload.meta;
      })
      .addCase(fetchFinanceTransactions.rejected, (state, action) => {
        state.transactions.loading = false;
        state.transactions.error = action.error.message ?? 'Failed to load transactions';
      })
      .addCase(createFinanceTransaction.fulfilled, (state, action: PayloadAction<FinanceTransaction>) => {
        state.transactions.data.unshift(action.payload);
        state.transactions.meta.count += 1;
      })
      .addCase(updateFinanceTransaction.fulfilled, (state, action: PayloadAction<FinanceTransaction>) => {
        state.transactions.data = state.transactions.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceTransaction.fulfilled, (state, action: PayloadAction<number>) => {
        state.transactions.data = state.transactions.data.filter((item) => item.id !== action.payload);
        state.transactions.meta.count = Math.max(0, state.transactions.meta.count - 1);
      })
      .addCase(createFinanceTransfer.fulfilled, (state, action: PayloadAction<{ debit: FinanceTransaction; credit: FinanceTransaction }>) => {
        state.transactions.data.unshift(action.payload.debit, action.payload.credit);
        state.transactions.meta.count += 2;
      });

    // Recurring rules
    builder
      .addCase(fetchFinanceRecurringRules.pending, (state) => {
        state.recurringRules.loading = true;
        state.recurringRules.error = null;
      })
      .addCase(fetchFinanceRecurringRules.fulfilled, (state, action: PayloadAction<FinanceRecurringRule[]>) => {
        state.recurringRules.loading = false;
        state.recurringRules.data = action.payload;
      })
      .addCase(fetchFinanceRecurringRules.rejected, (state, action) => {
        state.recurringRules.loading = false;
        state.recurringRules.error = action.error.message ?? 'Failed to load recurring rules';
      })
      .addCase(createFinanceRecurringRule.fulfilled, (state, action: PayloadAction<FinanceRecurringRule>) => {
        state.recurringRules.data.unshift(action.payload);
      })
      .addCase(updateFinanceRecurringRule.fulfilled, (state, action: PayloadAction<FinanceRecurringRule>) => {
        state.recurringRules.data = state.recurringRules.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceRecurringRule.fulfilled, (state, action: PayloadAction<number>) => {
        state.recurringRules.data = state.recurringRules.data.filter((item) => item.id !== action.payload);
      })
      .addCase(executeFinanceRecurringRules.pending, (state) => {
        state.recurringExecution.loading = true;
        state.recurringExecution.error = null;
      })
      .addCase(executeFinanceRecurringRules.fulfilled, (state, action: PayloadAction<{ processed: number; createdTransactions: number; skipped: number }>) => {
        state.recurringExecution.loading = false;
        state.recurringExecution.result = action.payload;
      })
      .addCase(executeFinanceRecurringRules.rejected, (state, action) => {
        state.recurringExecution.loading = false;
        state.recurringExecution.error = action.error.message ?? 'Failed to execute recurring rules';
      });

    // Budgets
    builder
      .addCase(fetchFinanceBudgets.pending, (state) => {
        state.budgets.loading = true;
        state.budgets.error = null;
      })
      .addCase(fetchFinanceBudgets.fulfilled, (state, action: PayloadAction<FinanceBudget[]>) => {
        state.budgets.loading = false;
        state.budgets.data = action.payload;
      })
      .addCase(fetchFinanceBudgets.rejected, (state, action) => {
        state.budgets.loading = false;
        state.budgets.error = action.error.message ?? 'Failed to load budgets';
      })
      .addCase(createFinanceBudget.fulfilled, (state, action: PayloadAction<FinanceBudget>) => {
        state.budgets.data.push(action.payload);
      })
      .addCase(updateFinanceBudget.fulfilled, (state, action: PayloadAction<FinanceBudget>) => {
        state.budgets.data = state.budgets.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(deleteFinanceBudget.fulfilled, (state, action: PayloadAction<number>) => {
        state.budgets.data = state.budgets.data.filter((item) => item.id !== action.payload);
      });

    // Management requests
    builder
      .addCase(fetchFinanceManagementRequests.pending, (state) => {
        state.managementRequests.loading = true;
        state.managementRequests.error = null;
      })
      .addCase(fetchFinanceManagementRequests.fulfilled, (state, action: PayloadAction<FinanceManagementRequest[]>) => {
        state.managementRequests.loading = false;
        state.managementRequests.data = action.payload;
      })
      .addCase(fetchFinanceManagementRequests.rejected, (state, action) => {
        state.managementRequests.loading = false;
        state.managementRequests.error = action.error.message ?? 'Failed to load management requests';
      })
      .addCase(createFinanceManagementRequest.fulfilled, (state, action: PayloadAction<FinanceManagementRequest>) => {
        state.managementRequests.data.unshift(action.payload);
      })
      .addCase(updateFinanceManagementRequest.fulfilled, (state, action: PayloadAction<FinanceManagementRequest>) => {
        state.managementRequests.data = state.managementRequests.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(approveFinanceManagementRequest.fulfilled, (state, action: PayloadAction<FinanceManagementRequest>) => {
        state.managementRequests.data = state.managementRequests.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(returnFinanceManagementRequest.fulfilled, (state, action: PayloadAction<FinanceManagementRequest>) => {
        state.managementRequests.data = state.managementRequests.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      })
      .addCase(rejectFinanceManagementRequest.fulfilled, (state, action: PayloadAction<FinanceManagementRequest>) => {
        state.managementRequests.data = state.managementRequests.data.map((item) => (item.id === action.payload.id ? action.payload : item));
      });

    // Files
    builder
      .addCase(fetchFinanceFiles.pending, (state) => {
        state.files.loading = true;
        state.files.error = null;
      })
      .addCase(fetchFinanceFiles.fulfilled, (state, action: PayloadAction<FinanceFile[]>) => {
        state.files.loading = false;
        state.files.items = action.payload;
      })
      .addCase(fetchFinanceFiles.rejected, (state, action) => {
        state.files.loading = false;
        state.files.error = action.error.message ?? 'Failed to load finance files';
      })
      .addCase(uploadFinanceFile.pending, (state) => {
        state.files.loading = true;
        state.files.error = null;
      })
      .addCase(uploadFinanceFile.fulfilled, (state, action: PayloadAction<FinanceFile>) => {
        state.files.loading = false;
        state.files.latest = action.payload;
        state.files.items = [action.payload, ...state.files.items];
      })
      .addCase(uploadFinanceFile.rejected, (state, action) => {
        state.files.loading = false;
        state.files.error = action.error.message ?? 'Failed to upload finance file';
      });
  },
});

export default financeSlice.reducer;

