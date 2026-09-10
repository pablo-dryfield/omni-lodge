import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';
import { performanceMonitorService } from '../services/performanceMonitorService.js';
import { runInRequestContext, setRequestContextValue } from '../services/requestContextService.js';
import { captureHttpFailureSafe, sanitizeUrlPath } from '../services/errorMonitoringService.js';

const instrumentMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestContext = performanceMonitorService.startRequest(req);
  const startedAt = process.hrtime.bigint();
  let completed = false;

  res.setHeader('X-Request-Id', requestContext.id);

  const finalize = (connectionClosedEarly = false): void => {
    if (completed) {
      return;
    }
    completed = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const contentLengthHeader = res.getHeader('content-length');
    const parsedContentLength =
      typeof contentLengthHeader === 'string'
        ? Number.parseInt(contentLengthHeader, 10)
        : typeof contentLengthHeader === 'number'
          ? contentLengthHeader
          : null;
    const responseBodySize = Number.isFinite(parsedContentLength ?? NaN) ? parsedContentLength : null;

    const statusCode = connectionClosedEarly && !res.writableEnded ? 499 : res.statusCode;
    performanceMonitorService.finishRequest(requestContext, statusCode, durationMs, responseBodySize);
    if (statusCode >= 400 && !res.locals.errorMonitoringExceptionCaptured) {
      captureHttpFailureSafe(req, {
        statusCode,
        durationMs,
        responseSizeBytes: responseBodySize,
        responseMessage: connectionClosedEarly ? 'Client closed the connection before completion' : null,
        requestId: requestContext.id,
      });
    }
  };

  res.on('finish', () => finalize(false));
  res.on('close', () => finalize(true));

  runInRequestContext(() => {
    setRequestContextValue('requestId', requestContext.id);
    setRequestContextValue('routeKey', requestContext.routeKey);
    setRequestContextValue('method', requestContext.method);
    setRequestContextValue('userId', requestContext.userId);
    setRequestContextValue('userTypeId', requestContext.userTypeId);
    setRequestContextValue('firstName', requestContext.firstName);
    setRequestContextValue('lastName', requestContext.lastName);
    setRequestContextValue('roleName', requestContext.roleName);
    logger.info(`Request received: ${req.method} ${sanitizeUrlPath(req.originalUrl ?? req.url) ?? '/'}`);
    next();
  });
};

export default instrumentMiddleware;
