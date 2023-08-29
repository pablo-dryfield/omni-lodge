import logger from '../utils/logger.js';

const errorMiddleware = (err, req, res, next) => {
  logger.error(`An error occurred: ${err.message}`);

  res.status(err.status || 500).json({
    error: {
      message: err.message,
    },
  });
};

export default errorMiddleware;