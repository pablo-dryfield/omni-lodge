import { createNamespace, Namespace } from 'cls-hooked';
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js'; // Adjust the path if necessary

const instrumentMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const ns: Namespace = createNamespace('my-namespace');
  ns.run(() => {
    // Set up any context data using the namespace
    ns.set('key', 'value');

    // Log the incoming request
    logger.info(`Request received: ${req.method} ${req.url}`);

    // Continue with the request handling
    next();
  });
};

export default instrumentMiddleware;
