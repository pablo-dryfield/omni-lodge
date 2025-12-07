import winston from 'winston';

// Define the log levels
const logLevels: winston.config.AbstractConfigSetLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LOG_LEVEL_VALUES: Array<keyof typeof logLevels> = ['error', 'warn', 'info', 'debug'];
const envLevel = (process.env.LOG_LEVEL ?? '').toLowerCase();
const consoleLevel: keyof typeof logLevels = LOG_LEVEL_VALUES.includes(envLevel as keyof typeof logLevels)
  ? (envLevel as keyof typeof logLevels)
  : 'debug';

const logger = winston.createLogger({
  levels: logLevels,
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({ level: consoleLevel as string }), // Log to console
    new winston.transports.File({ filename: 'error.log', level: 'error' }), // Log errors to a file
    new winston.transports.File({ filename: 'combined.log' }), // Log all levels to another file
  ],
});

export default logger;
