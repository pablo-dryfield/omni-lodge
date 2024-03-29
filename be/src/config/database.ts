import { Sequelize } from 'sequelize-typescript';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Channel from '../models/Channel.js';
import Guest from '../models/Guest.js';
import Review from '../models/Review.js';

dotenv.config();

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

// Create an instance of Sequelize for `sequelize-typescript`
const sequelize = new Sequelize({
  database: DB_NAME,
  dialect: 'postgres',
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  ssl: true, // Required if using Heroku Postgres Hobby Dev plan
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false // Required if using Heroku Postgres Hobby Dev plan
    }
  },
  port: parseInt(DB_PORT || '5432', 10), // Ensure the port is a number
  logging: false,
  models: [User, Booking, Channel, Guest, Review], // Specify the path to your models
  // You can also directly import models and add them here like [User, Post, ...]
});

export default sequelize;
