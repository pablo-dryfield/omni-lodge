import { Router } from 'express';
import multer from 'multer';
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
} from '../controllers/recurringRuleController.js';
import {
  uploadFinanceFileHandler,
  listFinanceFiles,
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

const router = Router();

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
router.post('/files', upload.single('file'), uploadFinanceFileHandler);

// Transactions
router.get('/transactions', listTransactions);
router.get('/transactions/:id', getTransaction);
router.post('/transactions', createTransactionHandler);
router.put('/transactions/:id', updateTransactionHandler);
router.delete('/transactions/:id', deleteTransaction);
router.post('/transfers', createTransferHandler);

// Recurring Rules
router.get('/recurring-rules', listRecurringRules);
router.get('/recurring-rules/:id', getRecurringRule);
router.post('/recurring-rules', createRecurringRule);
router.put('/recurring-rules/:id', updateRecurringRule);
router.delete('/recurring-rules/:id', deleteRecurringRule);
router.post('/recurring-runs/execute', executeRecurringRulesHandler);

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

// Reports
router.get('/reports', getFinanceReports);

// Stripe refunds
router.get('/refunds', listStripeRefunds);

export default router;
