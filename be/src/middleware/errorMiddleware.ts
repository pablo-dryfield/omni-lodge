import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js'; // Adjust the path if necessary
import { CustomError } from '../types/CustomError.js';

const errorMiddleware = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  logger.error(`An error occurred: ${err.message}`);

  res.status(err.status || 500).json({
    error: {
      message: err.message || 'An unexpected error occurred',
    },
  });
};

export default errorMiddleware;
