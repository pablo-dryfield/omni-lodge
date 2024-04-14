import Booking from './Booking.js';
import Channel from './Channel.js';
import Counter from './Counter.js';
import CounterProduct from './CounterProduct.js';
import Guest from './Guest.js';
import Product from './Product.js';
import ProductType from './ProductType.js';
import Review from './Review.js';
import User from './User.js';
import UserType from './UserType.js';

export function defineAssociations() {
  // User Associations
  User.belongsTo(UserType, { foreignKey: 'userTypeId' });

  // UserType Associations
  UserType.hasMany(User, { foreignKey: 'userTypeId' });
  UserType.hasOne(User, { foreignKey: 'createdBy' });
  UserType.hasOne(User, { foreignKey: 'updatedBy' });

  // Product Associations
  Product.belongsTo(ProductType, { foreignKey: 'productTypeId' });
  Product.hasOne(User, { foreignKey: 'createdBy' });
  Product.hasOne(User, { foreignKey: 'updatedBy' });

  // ProductType Associations
  ProductType.hasMany(Product, { foreignKey: 'productTypeId' });
  ProductType.hasOne(User, { foreignKey: 'createdBy' });
  ProductType.hasOne(User, { foreignKey: 'updatedBy' });

  // Counter Associations
  Counter.hasMany(CounterProduct, { foreignKey: 'counterid' });
  Counter.belongsTo(User, { foreignKey: 'userId' });
  Counter.hasOne(User, { foreignKey: 'createdBy' });
  Counter.hasOne(User, { foreignKey: 'updatedBy' });
  
  // CounterProduct Associations
  CounterProduct.belongsTo(Counter, { foreignKey: 'counterid' });
  CounterProduct.belongsTo(Product, { foreignKey: 'productid' });
  CounterProduct.hasOne(User, { foreignKey: 'createdBy' });
  CounterProduct.hasOne(User, { foreignKey: 'updatedBy' });

  // Review Associations
  Review.hasOne(User, { foreignKey: 'createdBy' });
  Review.hasOne(User, { foreignKey: 'updatedBy' });

  // Booking Associations
  Booking.belongsTo(Guest, { foreignKey: 'guestId' });
  Booking.belongsTo(Channel, { foreignKey: 'channelId' });
  Booking.hasOne(User, { foreignKey: 'createdBy' });
  Booking.hasOne(User, { foreignKey: 'updatedBy' });

  // Guest Associations
  Guest.hasMany(Booking, { foreignKey: 'guestId' });
  Guest.hasOne(User, { foreignKey: 'createdBy' });
  Guest.hasOne(User, { foreignKey: 'updatedBy' });

  // Channel Associations
  Channel.hasMany(Booking, { foreignKey: 'channelId' });
  Channel.hasOne(User, { foreignKey: 'createdBy' });
  Channel.hasOne(User, { foreignKey: 'updatedBy' });
}
