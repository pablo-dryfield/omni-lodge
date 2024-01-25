import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js'; // Adjust the path if necessary

// If you have a custom error type, you can define it here
interface CustomError extends Error {
  status?: number;
}

const errorMiddleware = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  logger.error(`An error occurred: ${err.message}`);

  res.status(err.status || 500).json({
    error: {
      message: err.message || 'An unexpected error occurred',
    },
  });
};

export default errorMiddleware;
