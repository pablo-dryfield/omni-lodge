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
import bookingRoutes from './routes/bookingRoutes.js';
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

// Sequelize instance and middlewares (make sure these are also migrated to .ts)
import sequelize from './config/database.js';
import logger from './utils/logger.js';
import instrumentMiddleware from './middleware/instrumentMiddleware.js';
import errorMiddleware from './middleware/errorMiddleware.js';
import { defineAssociations } from './models/defineAssociations.js';

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

// API Requests limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

// Initialize Express
const app = express();

// Cookies 
app.use(cookieParser());

// Configure CORS middleware
const allowedOrigins = ['http://localhost:3000', 'https://omni-lodge.netlify.app', '195.20.3.6', 'https://omni-lodge.work.gd:443','http://omni-lodge.work.gd:443', 'http://23.95.192.213:443', 'https://23.95.192.213:443', 'https://23.95.192.213', 'http://23.95.192.213','https://omni-lodge.work.gd','http://omni-lodge.work.gd'];

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
  credentials: true // enable CORS credentials
}));

app.use(express.json());

// Use helmet middleware to set various security headers, including CSP
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  },
}));

// Instrumentation 
app.use(instrumentMiddleware);

// Apply the rate limit middleware to all routes
app.use("/api/", apiLimiter);

// Routes
app.use('/api/guests', guestRoutes);
app.use('/api/bookings', bookingRoutes);
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

// Error Handling
app.use(errorMiddleware);

// Sample Endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('OmniLodge Backend API');
});

// Sync database and then start server
const PORT: number = parseInt(process.env.PORT || '3001');

sequelize.sync({ force: false }) // Set to 'true' carefully, it will drop the database
  .then(() => {
    defineAssociations();
    if(process.env.NODE_ENV === 'production'){
      // Define the directory path where the SSL certificate files are located
      const sslDir = path.join(__dirname, '../src/ssl');

      // Read SSL certificate and private key files
      const options = {
        key: fs.readFileSync(path.join(sslDir, 'omni-lodge.work.gd.key')), // Read the private key file
        cert: fs.readFileSync(path.join(sslDir, 'omni-lodge.work.gd.cer')), // Read the SSL certificate file
        ca: fs.readFileSync(path.join(sslDir, 'ca.cer')), // Read the CA certificate file (if applicable)
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
      // Handle validation errors
      logger.error('Validation error:', err.errors);
    } else {
      // Handle generic errors
      logger.error('Unable to connect to the database:', err.message);
    }
  });
