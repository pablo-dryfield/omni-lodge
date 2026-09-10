import express, { type NextFunction, type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';

import { ingestBrowserErrorReports, ingestClientErrors } from '../controllers/clientErrorController.js';
import optionalErrorMonitoringAuth from '../middleware/optionalErrorMonitoringAuth.js';

const router = Router();

const clientErrorLimiter = rateLimit({
  windowMs: 10 * 60 * 1_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many error reports. Please try again later.' },
});

const browserReportLimiter = rateLimit({
  windowMs: 10 * 60 * 1_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many browser reports. Please try again later.' },
});

const rejectLargeReport = (req: Request, res: Response, next: NextFunction): void => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1_024) {
    res.status(413).json({ message: 'Error report is too large.' });
    return;
  }
  next();
};

const rejectLargeParsedReport = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8');
    if (bytes > 64 * 1_024) {
      res.status(413).json({ message: 'Error report is too large.' });
      return;
    }
  } catch {
    res.status(400).json({ message: 'Error report must be valid JSON.' });
    return;
  }
  next();
};

const clientErrorJson = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '64kb',
});

router.post(
  '/batch',
  clientErrorLimiter,
  rejectLargeReport,
  clientErrorJson,
  rejectLargeParsedReport,
  optionalErrorMonitoringAuth,
  ingestClientErrors,
);
router.post(
  '/browser-reports',
  browserReportLimiter,
  rejectLargeReport,
  clientErrorJson,
  rejectLargeParsedReport,
  optionalErrorMonitoringAuth,
  ingestBrowserErrorReports,
);

export default router;
