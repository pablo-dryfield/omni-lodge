import { Router } from 'express';
import multer from 'multer';
import {
  authorizeModuleAction,
  requireRoles,
} from '../../middleware/authorizationMiddleware.js';
import { financeAuthChain } from '../middleware/financeAccessMiddleware.js';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
} from '../controllers/accountController.js';
import {
  listCategories,
  searchCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';
import {
  listVendors,
  searchVendors,
  getVendor,
  createVendor,
  updateVendor,
  deleteVendor,
} from '../controllers/vendorController.js';
import {
  listClients,
  searchClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
} from '../controllers/clientController.js';
import {
  listTransactions,
  getTransaction,
  createTransactionHandler,
  updateTransactionHandler,
  deleteTransaction,
  createTransferHandler,
} from '../controllers/transactionController.js';
import {
  listRecurringRules,
  getRecurringRule,
  createRecurringRule,
  updateRecurringRule,
  deleteRecurringRule,
  executeRecurringRulesHandler,
  getRecurringWorkspaceBootstrap,
  listRecurringRuleOccurrences,
  postRecurringRuleOccurrence,
  voidRecurringRuleOccurrence,
} from '../controllers/recurringRuleController.js';
import {
  uploadFinanceFileHandler,
  listFinanceFiles,
  downloadFinanceFileHandler,
} from '../controllers/fileController.js';
import {
  listManagementRequests,
  getManagementRequest,
  createManagementRequest,
  updateManagementRequest,
  approveManagementRequest,
  returnManagementRequest,
  rejectManagementRequest,
} from '../controllers/managementRequestController.js';
import {
  listBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
} from '../controllers/budgetController.js';
import { getFinanceReports } from '../controllers/reportController.js';
import { listStripeRefunds } from '../controllers/refundController.js';
import {
  bulkUpdateSettlementRules,
  createSettlementRuleHandler,
  deleteSettlementRuleHandler,
  getSettlementRule,
  listSettlementRules,
  updateSettlementRuleHandler,
} from '../controllers/compensationSettlementRuleController.js';
import {
  createVolunteerFundAdjustment,
  createVolunteerFundHandler,
  createVolunteerFundSpend,
  deleteVolunteerFundHandler,
  getVolunteerFund,
  getVolunteerFundLedger,
  listVolunteerFunds,
  reverseVolunteerFundEntryHandler,
  updateVolunteerFundHandler,
} from '../controllers/volunteerFundController.js';

const router = Router();
const settlementRuleWriteGuard = requireRoles(['admin', 'owner']);
const recurringViewGuard = authorizeModuleAction('finance-recurring', 'view');
const recurringCreateGuard = authorizeModuleAction('finance-recurring', 'create');
const recurringUpdateGuard = authorizeModuleAction('finance-recurring', 'update');
const recurringDeleteGuard = authorizeModuleAction('finance-recurring', 'delete');
const transactionViewGuard = authorizeModuleAction('finance-transactions', 'view');
const transactionCreateGuard = authorizeModuleAction('finance-transactions', 'create');
const transactionUpdateGuard = authorizeModuleAction('finance-transactions', 'update');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

router.use(...financeAuthChain);

// Accounts
router.get('/accounts', listAccounts);
router.get('/accounts/:id', getAccount);
router.post('/accounts', createAccount);
router.put('/accounts/:id', updateAccount);
router.delete('/accounts/:id', deleteAccount);

// Categories
router.get('/categories', listCategories);
router.get('/categories/search', searchCategories);
router.get('/categories/:id', getCategory);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Vendors
router.get('/vendors', listVendors);
router.get('/vendors/search', searchVendors);
router.get('/vendors/:id', getVendor);
router.post('/vendors', createVendor);
router.put('/vendors/:id', updateVendor);
router.delete('/vendors/:id', deleteVendor);

// Clients
router.get('/clients', listClients);
router.get('/clients/search', searchClients);
router.get('/clients/:id', getClient);
router.post('/clients', createClient);
router.put('/clients/:id', updateClient);
router.delete('/clients/:id', deleteClient);

// Files
router.get('/files', listFinanceFiles);
router.get('/files/:id/download', downloadFinanceFileHandler);
router.post('/files', upload.single('file'), uploadFinanceFileHandler);

// Transactions
router.get('/transactions', listTransactions);
router.get('/transactions/:id', getTransaction);
router.post('/transactions', createTransactionHandler);
router.put('/transactions/:id', updateTransactionHandler);
router.delete('/transactions/:id', deleteTransaction);
router.post('/transfers', createTransferHandler);

// Recurring Rules
router.get('/recurring-rules', recurringViewGuard, listRecurringRules);
router.get('/recurring-rules/bootstrap', recurringViewGuard, getRecurringWorkspaceBootstrap);
router.get(
  '/recurring-rules/:id/occurrences',
  recurringViewGuard,
  transactionViewGuard,
  listRecurringRuleOccurrences,
);
router.post(
  '/recurring-rules/:id/occurrences/:transactionId/post',
  recurringUpdateGuard,
  transactionUpdateGuard,
  postRecurringRuleOccurrence,
);
router.post(
  '/recurring-rules/:id/occurrences/:transactionId/void',
  recurringUpdateGuard,
  transactionUpdateGuard,
  voidRecurringRuleOccurrence,
);
router.get('/recurring-rules/:id', recurringViewGuard, getRecurringRule);
router.post('/recurring-rules', recurringCreateGuard, createRecurringRule);
router.put('/recurring-rules/:id', recurringUpdateGuard, updateRecurringRule);
router.delete('/recurring-rules/:id', recurringDeleteGuard, deleteRecurringRule);
router.post(
  '/recurring-runs/execute',
  recurringUpdateGuard,
  transactionCreateGuard,
  executeRecurringRulesHandler,
);

// Management Requests
router.get('/management-requests', listManagementRequests);
router.get('/management-requests/:id', getManagementRequest);
router.post('/management-requests', createManagementRequest);
router.put('/management-requests/:id', updateManagementRequest);
router.post('/management-requests/:id/approve', approveManagementRequest);
router.post('/management-requests/:id/return', returnManagementRequest);
router.post('/management-requests/:id/reject', rejectManagementRequest);

// Budgets
router.get('/budgets', listBudgets);
router.get('/budgets/:id', getBudget);
router.post('/budgets', createBudget);
router.put('/budgets/:id', updateBudget);
router.delete('/budgets/:id', deleteBudget);

// Compensation settlement routing
router.get('/settlement-rules', listSettlementRules);
router.post('/settlement-rules', settlementRuleWriteGuard, createSettlementRuleHandler);
router.put('/settlement-rules/bulk', settlementRuleWriteGuard, bulkUpdateSettlementRules);
router.get('/settlement-rules/:id', getSettlementRule);
router.put('/settlement-rules/:id', settlementRuleWriteGuard, updateSettlementRuleHandler);
router.delete('/settlement-rules/:id', settlementRuleWriteGuard, deleteSettlementRuleHandler);

// Volunteer funds and append-only ledger
router.get('/volunteer-funds', listVolunteerFunds);
router.post('/volunteer-funds', createVolunteerFundHandler);
router.get('/volunteer-funds/:id', getVolunteerFund);
router.put('/volunteer-funds/:id', updateVolunteerFundHandler);
router.delete('/volunteer-funds/:id', deleteVolunteerFundHandler);
router.get('/volunteer-funds/:id/ledger', getVolunteerFundLedger);
router.post('/volunteer-funds/:id/adjustments', createVolunteerFundAdjustment);
router.post('/volunteer-funds/:id/spend', createVolunteerFundSpend);
router.post('/volunteer-funds/:id/entries/:entryId/reversal', reverseVolunteerFundEntryHandler);

// Reports
router.get('/reports', getFinanceReports);

// Stripe refunds
router.get('/refunds', listStripeRefunds);

export default router;
