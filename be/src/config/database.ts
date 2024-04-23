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

dotenv.config();

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

// Create an instance of Sequelize for `sequelize-typescript`
const sequelize = new Sequelize({
  database: DB_NAME,
  dialect: 'postgres',
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  ssl: false, // Required if using Heroku Postgres Hobby Dev plan
  /*dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false // Required if using Heroku Postgres Hobby Dev plan
    }
  },*/
  port: parseInt(DB_PORT || '5432', 10), // Ensure the port is a number
  logging: false,
  models: [User, Booking, Channel, Guest, Review, Counter, CounterProduct, CounterUser, Product, ProductType, UserType], // Specify the path to your models
  // You can also directly import models and add them here like [User, Post, ...]
});

export default sequelize;
