import { createNamespace } from 'cls-hooked';
import logger from '../utils/logger.js';

const instrumentMiddleware = (req, res, next) => {
  const ns = createNamespace('my-namespace');
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
