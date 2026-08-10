import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js'; // Adjust the path if necessary
import { CustomError } from '../types/CustomError.js';

const errorMiddleware = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  const status = err.status || 500;
  const reference = randomUUID();
  const orderReference = typeof req.params?.publicId === 'string' ? req.params.publicId : 'none';
  const stack = err.stack ? `\n${err.stack}` : '';
  logger.error(
    `[request-error] reference=${reference} method=${req.method} path=${req.path} order=${orderReference} status=${status} error=${err.message}${stack}`,
  );

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
