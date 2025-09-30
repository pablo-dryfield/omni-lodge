import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { collectDefaultMetrics } from 'prom-client';
import { ValidationError } from 'sequelize';

// TypeScript routes imports (make sure all route files are .ts)
import guestRoutes from './routes/guestRoutes.js';
//import bookingRoutes from './routes/bookingRoutes.js';
import channelRoutes from './routes/channelRoutes.js';
import userRoutes from './routes/userRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import counterRoutes from './routes/counterRoutes.js';
import counterProductRoutes from './routes/counterProductRoutes.js';
import counterUserRoutes from './routes/counterUserRoutes.js';
import productRoutes from './routes/productRoutes.js';
import productTypeRoutes from './routes/productTypeRoutes.js';
import userTypeRoutes from './routes/userTypeRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import pageRoutes from './routes/pageRoutes.js';
import moduleRoutes from './routes/moduleRoutes.js';
import actionRoutes from './routes/actionRoutes.js';
import moduleActionRoutes from './routes/moduleActionRoutes.js';
import rolePagePermissionRoutes from './routes/rolePagePermissionRoutes.js';
import roleModulePermissionRoutes from './routes/roleModulePermissionRoutes.js';
import accessControlRoutes from './routes/accessControlRoutes.js';
import ecwidRoutes from './routes/ecwidRoutes.js';

// Sequelize instance and middlewares (make sure these are also migrated to .ts)
import sequelize from './config/database.js';
import logger from './utils/logger.js';
import instrumentMiddleware from './middleware/instrumentMiddleware.js';
import errorMiddleware from './middleware/errorMiddleware.js';
import { defineAssociations } from './models/defineAssociations.js';
import { initializeAccessControl } from './utils/initializeAccessControl.js';

// Scrapers
// import { scrapeTripAdvisor } from './scrapers/tripAdvisorScraper.js';

// Initialize default metrics collection
collectDefaultMetrics();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const environment = (process.env.NODE_ENV || 'development').trim();
const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: envFile });

const shouldAlterSchema = (process.env.DB_SYNC_ALTER ?? 'true').toLowerCase() !== 'false';

// API Requests limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Initialize Express
const app = express();

// Cookies 
app.use(cookieParser());

// Configure CORS middleware
const allowedOrigins = ['http://localhost:3000', 'https://omni-lodge.netlify.app', '195.20.3.6', 'https://omni-lodge.work.gd:443','http://omni-lodge.work.gd:443', 'http://23.95.192.213:443', 'https://23.95.192.213:443', 'https://23.95.192.213', 'http://23.95.192.213','https://omni-lodge.work.gd','http://omni-lodge.work.gd','http://omni-lodge.com','http://omni-lodge.com','https://omni-lodge.com:443','http://omni-lodge.com:443'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  credentials: true
}));

app.use(express.json());

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  },
}));

app.use(instrumentMiddleware);

app.use('/api/', apiLimiter);

app.use('/api/guests', guestRoutes);
//app.use('/api/bookings', bookingRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/counters', counterRoutes);
app.use('/api/counterProducts', counterProductRoutes);
app.use('/api/counterUsers', counterUserRoutes);
app.use('/api/products', productRoutes);
app.use('/api/productTypes', productTypeRoutes);
app.use('/api/userTypes', userTypeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/actions', actionRoutes);
app.use('/api/moduleActions', moduleActionRoutes);
app.use('/api/rolePagePermissions', rolePagePermissionRoutes);
app.use('/api/roleModulePermissions', roleModulePermissionRoutes);
app.use('/api/accessControl', accessControlRoutes);
app.use('/api/ecwid', ecwidRoutes);

app.use(errorMiddleware);

app.get('/', (req: Request, res: Response) => {
  res.send('OmniLodge Backend API');
});

const PORT: number = parseInt(process.env.PORT || '3001');

logger.info(`Synchronizing database schema (alter=${shouldAlterSchema})`);

sequelize.sync({ force: false, alter: shouldAlterSchema })
  .then(async () => {
    defineAssociations();

    try {
      await initializeAccessControl();
    } catch (seedError) {
      logger.error('Failed to initialize access control data', seedError);
    }
    if(process.env.NODE_ENV === 'production'){
      app.set('trust proxy', 1);
      const sslDir = path.join(__dirname, '../src/ssl');

      const options = {
        key: fs.readFileSync(path.join(sslDir, 'cf-origin.key')),
        cert: fs.readFileSync(path.join(sslDir, 'cf-origin.pem')),
      };
      const server = https.createServer(options, app);
      server.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server is running on port ${PORT}`);
    });
    }else{
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server is running on port ${PORT}`);
      });
    }
  })
  .catch((err: Error | ValidationError) => {
    if (err instanceof ValidationError) {
      logger.error(`Validation error: ${JSON.stringify(err.errors, null, 2)}`);
    } else {
      logger.error('Database synchronization failed', err);
    }
  });







