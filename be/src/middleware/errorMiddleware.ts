import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js'; // Adjust the path if necessary
import { CustomError } from '../types/CustomError.js';
import {
  captureBackendExceptionSafe,
  redactSensitiveText,
  sanitizeUrlPath,
} from '../services/errorMonitoringService.js';
import { getRequestContextValue } from '../services/requestContextService.js';

const errorMiddleware = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  const status = err.status || 500;
  const requestId = getRequestContextValue('requestId');
  const reference = requestId ?? randomUUID();
  const orderReference = typeof req.params?.publicId === 'string'
    ? redactSensitiveText(req.params.publicId).slice(0, 160)
    : 'none';
  const safeMessage = redactSensitiveText(err.message || err.name || 'Request failed').slice(0, 2_000);
  const stack = err.stack ? `\n${redactSensitiveText(err.stack).slice(0, 30_000)}` : '';
  const safePath = sanitizeUrlPath(req.path, 500) ?? '/';
  logger.error(
    `[request-error] reference=${reference} method=${req.method} path=${safePath} order=${orderReference} status=${status} error=${safeMessage}${stack}`,
  );
  res.locals.errorMonitoringExceptionCaptured = true;
  captureBackendExceptionSafe(err, req, {
    statusCode: status,
    reference,
    requestId,
  });

  res.status(status).json({
    error: {
      message:
        status >= 500
          ? `We could not complete this request. Please try again or contact support. Error reference: ${reference}.`
          : err.message || 'The request could not be completed.',
      reference,
    },
  });
};

export default errorMiddleware;
