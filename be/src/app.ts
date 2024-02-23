import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { collectDefaultMetrics } from 'prom-client';
import { ValidationError  } from 'sequelize';

// TypeScript routes imports (make sure all route files are .ts)
import guestRoutes from './routes/guestRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import channelRoutes from './routes/channelRoutes.js';
import userRoutes from './routes/userRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';

// Sequelize instance and middlewares (make sure these are also migrated to .ts)
import sequelize from './config/database.js';
import logger from './utils/logger.js';
import instrumentMiddleware from './middleware/instrumentMiddleware.js';
import errorMiddleware from './middleware/errorMiddleware.js';
import { defineAssociations } from './models/defineAssociations.js';

// Initialize default metrics collection
collectDefaultMetrics();

// Load environment variables
dotenv.config();

// API Requests limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

// Initialize Express
const app = express();

// Middleware
const allowedOrigins = ['http://localhost:3000'];

// Cookies 
app.use(cookieParser());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
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

// Error Handling
app.use(errorMiddleware);

// Sample Endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('OmniLodge Backend API');
});

// Sync database and then start server
const PORT = process.env.PORT || 3001;
sequelize.sync({ force: false }) // Set to 'true' carefully, it will drop the database
  .then(() => {
    defineAssociations();
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
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
