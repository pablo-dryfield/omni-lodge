import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import guestRoutes from './routes/guestRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import channelRoutes from './routes/channelRoutes.js';
import userRoutes from './routes/userRoutes.js';
import { sequelize } from './models/index.js'; // Import Sequelize instance
import logger from './utils/logger.js';
import { collectDefaultMetrics } from 'prom-client';
import instrumentMiddleware from './middleware/instrumentMiddleware.js';
import errorMiddleware from './middleware/errorMiddleware.js';
import helmet from 'helmet';

// Initialize default metrics collection
collectDefaultMetrics();

// API Requests limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// Middleware
//const allowedOrigins = ['https://yourwebsite.com', 'https://www.yourwebsite.com'];
const allowedOrigins = ['http://localhost:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
);

app.use(express.json());

// Use helmet middleware to set various security headers, including CSP
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"], // Allow content from the same origin
    scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts (unsafe)
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], // Allow inline styles and Google Fonts
    // Add more directives as needed
  },
}));

// Instrumentation 
app.use(instrumentMiddleware);

// Apply the rate limit middleware to all routes
app.use("/api/", apiLimiter);

// Import Routes
app.use('/api/guests', guestRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/users', userRoutes);

// Error Handling
app.use(errorMiddleware);

// Sample Endpoint
app.get('/', (req, res) => {
  res.send('OmniLodge Backend API');
});

// Sync database and then start server
const PORT = process.env.PORT || 3001;
sequelize.sync()
  .then(() => {
  
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  })
  .catch(err => {
    logger.error('Unable to connect to the database:', err);
  });
  

