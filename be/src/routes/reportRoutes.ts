import express, { Request, Response, NextFunction, Router } from 'express';
import * as reportController from '../controllers/reportController.js'; // Adjust the import path as necessary
import * as derivedFieldController from '../controllers/derivedFieldController.js';
import * as dashboardController from '../controllers/dashboardController.js';
import * as templateScheduleController from '../controllers/templateScheduleController.js';
import * as homePreferenceController from '../controllers/homePreferenceController.js';
import { check, param, validationResult } from 'express-validator';
import authMiddleware from '../middleware/authMiddleware.js'; // Adjust the import path as necessary
import { requireRoles } from '../middleware/authorizationMiddleware.js';

const router: Router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Middleware to check validation result
const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() }); // Removed 'return' to adhere to 'void' type
    return; 
  }
  next();
};

router.get('/getCommissionByDateRange', authMiddleware, reportController.getCommissionByDateRange);
router.get('/models', authMiddleware, reportController.listReportModels);
router.post('/preview', authMiddleware, reportController.runReportPreview);
router.post('/query', authMiddleware, reportController.executeReportQuery);
router.get('/query/jobs/:jobId', authMiddleware, reportController.getReportQueryJobStatus);
router.get('/templates', authMiddleware, reportController.listReportTemplates);
router.post('/templates', authMiddleware, reportController.createReportTemplate);
router.put('/templates/:id', authMiddleware, reportController.updateReportTemplate);
router.delete('/templates/:id', authMiddleware, reportController.deleteReportTemplate);
router.get('/templates/:templateId/schedules', authMiddleware, templateScheduleController.listTemplateSchedules);
router.post('/templates/:templateId/schedules', authMiddleware, templateScheduleController.createTemplateSchedule);
router.put('/templates/:templateId/schedules/:scheduleId', authMiddleware, templateScheduleController.updateTemplateSchedule);
router.delete('/templates/:templateId/schedules/:scheduleId', authMiddleware, templateScheduleController.deleteTemplateSchedule);
router.get('/derived-fields', authMiddleware, derivedFieldController.listDerivedFields);
router.post('/derived-fields', authMiddleware, derivedFieldController.createDerivedField);
router.put('/derived-fields/:id', authMiddleware, derivedFieldController.updateDerivedField);
router.delete('/derived-fields/:id', authMiddleware, derivedFieldController.deleteDerivedField);
router.get('/dashboards', authMiddleware, dashboardController.listDashboards);
router.post('/dashboards', authMiddleware, dashboardController.createDashboard);
router.put('/dashboards/:id', authMiddleware, dashboardController.updateDashboard);
router.delete('/dashboards/:id', authMiddleware, dashboardController.deleteDashboard);
router.post('/dashboards/:id/cards', authMiddleware, dashboardController.upsertDashboardCard);
router.put('/dashboards/:id/cards/:cardId', authMiddleware, dashboardController.upsertDashboardCard);
router.delete('/dashboards/:id/cards/:cardId', authMiddleware, dashboardController.deleteDashboardCard);
router.post('/dashboards/:id/cards/:cardId/preview', authMiddleware, dashboardController.runDashboardPreviewCard);
router.post('/dashboards/:id/export', authMiddleware, dashboardController.exportDashboard);
router.get('/home-preferences', authMiddleware, homePreferenceController.getHomePreference);
router.put('/home-preferences', authMiddleware, homePreferenceController.updateHomePreference);
router.get(
  '/home-preferences/:userId',
  authMiddleware,
  requireRoles(['admin', 'owner']),
  homePreferenceController.getHomePreferenceForUser,
);
router.put(
  '/home-preferences/:userId',
  authMiddleware,
  requireRoles(['admin', 'owner']),
  homePreferenceController.updateHomePreferenceForUser,
);

export default router;
