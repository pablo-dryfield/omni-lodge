import { useEffect } from 'react';
import { useAppDispatch } from '../store/hooks';
import {
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceClients,
  fetchFinanceVendors,
} from '../actions/financeActions';

export const useFinanceBootstrap = (): void => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchFinanceAccounts());
    dispatch(fetchFinanceCategories());
    dispatch(fetchFinanceVendors());
    dispatch(fetchFinanceClients());
  }, [dispatch]);
};

