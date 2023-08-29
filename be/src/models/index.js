import { Sequelize } from 'sequelize';
import sequelize from '../config/database.js';  // This imports the Sequelize instance

// Importing your models
import GuestModel from './Guest.js';
import BookingModel from './Booking.js';
import ChannelModel from './Channel.js';
import UserModel from './User.js';

// No need to create a new Sequelize instance
// const sequelize = new Sequelize(config);

const models = {
  Guest: GuestModel.init(sequelize, Sequelize.DataTypes),
  Booking: BookingModel.init(sequelize, Sequelize.DataTypes),
  Channel: ChannelModel.init(sequelize, Sequelize.DataTypes),
  User: UserModel.init(sequelize, Sequelize.DataTypes),
};

// This loops over all the models and invokes the associate method if it exists
// This creates the actual association in sequelize
Object.values(models)
  .filter(model => typeof model.associate === 'function')
  .forEach(model => model.associate(models));

export { sequelize }; // This is used elsewhere in the app for the actual connection
export default models; // This is used for the model relationships
