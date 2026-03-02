import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';
import { performanceMonitorService } from '../services/performanceMonitorService.js';
import { runInRequestContext, setRequestContextValue } from '../services/requestContextService.js';

const instrumentMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestContext = performanceMonitorService.startRequest(req);
  const startedAt = process.hrtime.bigint();
  let completed = false;

  const finalize = (): void => {
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

    performanceMonitorService.finishRequest(requestContext, res.statusCode, durationMs, responseBodySize);
  };

  res.on('finish', finalize);
  res.on('close', finalize);

  runInRequestContext(() => {
    setRequestContextValue('requestId', requestContext.id);
    setRequestContextValue('routeKey', requestContext.routeKey);
    setRequestContextValue('method', requestContext.method);
    setRequestContextValue('userId', requestContext.userId);
    setRequestContextValue('userTypeId', requestContext.userTypeId);
    setRequestContextValue('firstName', requestContext.firstName);
    setRequestContextValue('lastName', requestContext.lastName);
    setRequestContextValue('roleName', requestContext.roleName);
    logger.info(`Request received: ${req.method} ${req.url}`);
    next();
  });
};

export default instrumentMiddleware;
