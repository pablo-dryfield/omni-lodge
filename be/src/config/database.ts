import { Sequelize } from 'sequelize-typescript';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Channel from '../models/Channel.js';
import Guest from '../models/Guest.js';
import Review from '../models/Review.js';
import Counter from '../models/Counter.js';
import CounterProduct from '../models/CounterProduct.js';
import CounterUser from '../models/CounterUser.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import UserType from '../models/UserType.js';

// Load environment variables
const environment = process.env.NODE_ENV || 'development';
const envFile = (environment.trim() === 'production' ? '.env.prod' : '.env.dev');
dotenv.config({ path: envFile });

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, PGSSLMODE } = process.env;

// Determine whether SSL should be enabled
const sslConfig = PGSSLMODE === 'require' ? { ssl: true } : { ssl: false };

// Create an instance of Sequelize for `sequelize-typescript`
const sequelize = new Sequelize({
  database: DB_NAME,
  dialect: 'postgres',
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  port: parseInt(DB_PORT || '5432', 10), // Ensure the port is a number
  logging: false,
  dialectOptions: {
    ssl: false,
  },
  models: [User, Booking, Channel, Guest, Review, Counter, CounterProduct, CounterUser, Product, ProductType, UserType],
});

export default sequelize;
