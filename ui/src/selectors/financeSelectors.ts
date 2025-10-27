import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store/store';

export const selectFinanceState = (state: RootState) => state.finance;

export const selectFinanceAccounts = createSelector(selectFinanceState, (state) => state.accounts);
export const selectFinanceCategories = createSelector(selectFinanceState, (state) => state.categories);
export const selectFinanceVendors = createSelector(selectFinanceState, (state) => state.vendors);
export const selectFinanceClients = createSelector(selectFinanceState, (state) => state.clients);
export const selectFinanceTransactions = createSelector(selectFinanceState, (state) => state.transactions);
export const selectFinanceRecurringRules = createSelector(selectFinanceState, (state) => state.recurringRules);
export const selectFinanceBudgets = createSelector(selectFinanceState, (state) => state.budgets);
export const selectFinanceManagementRequests = createSelector(selectFinanceState, (state) => state.managementRequests);
export const selectFinanceFiles = createSelector(selectFinanceState, (state) => state.files);
export const selectFinanceRecurringExecution = createSelector(selectFinanceState, (state) => state.recurringExecution);

