import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import guestRoutes from './routes/guestRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import channelRoutes from './routes/channelRoutes.js';
import { sequelize } from './models/index.js'; // Import Sequelize instance

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import Routes
app.use('/api/guests', guestRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/channels', channelRoutes);

// Sample Endpoint
app.get('/', (req, res) => {
  res.send('OmniLodge Backend API');
});

// Sync database and then start server
const PORT = process.env.PORT || 3001;
sequelize.sync()
  .then(() => {
  
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });
  

