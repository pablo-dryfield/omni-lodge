import Booking from './Booking.js';
import Channel from './Channel.js';
import Counter from './Counter.js';
import CounterProduct from './CounterProduct.js';
import CounterUser from './CounterUser.js';
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
  UserType.belongsTo(User, { foreignKey: 'createdBy' });
  UserType.belongsTo(User, { foreignKey: 'updatedBy' });

  // Product Associations
  Product.belongsTo(ProductType, { foreignKey: 'productTypeId' });
  Product.belongsTo(User, { foreignKey: 'createdBy' });
  Product.belongsTo(User, { foreignKey: 'updatedBy' });

  // ProductType Associations
  ProductType.hasMany(Product, { foreignKey: 'productTypeId' });
  ProductType.belongsTo(User, { foreignKey: 'createdBy' });
  ProductType.belongsTo(User, { foreignKey: 'updatedBy' });

  // Counter Associations
  Counter.hasMany(CounterProduct, { foreignKey: 'counterId', onDelete: 'CASCADE', as: 'products' });
  Counter.hasMany(CounterUser, { foreignKey: 'counterId', onDelete: 'CASCADE', as: 'users' });
  Counter.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  Counter.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  Counter.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });

  // CounterProduct Associations
  CounterProduct.belongsTo(Counter, { foreignKey: 'counterId', as: 'counterProductCounterId', onDelete: 'CASCADE' });
  CounterProduct.belongsTo(Product, { foreignKey: 'productId', as: 'counterProductProductId' });
  CounterProduct.belongsTo(User, { foreignKey: 'createdBy', as: 'counterProductCreatedByUser' });
  CounterProduct.belongsTo(User, { foreignKey: 'updatedBy', as: 'counterProductUpdatedByUser' });

  // CounterUser Associations
  CounterUser.belongsTo(Counter, { foreignKey: 'counterId', onDelete: 'CASCADE' , as: 'counter'});
  CounterUser.belongsTo(User, { foreignKey: 'userId', as: 'counterUser' });
  CounterUser.belongsTo(User, { foreignKey: 'createdBy', as: 'counterCreatedByUser' });
  CounterUser.belongsTo(User, { foreignKey: 'updatedBy', as: 'counterUpdatedByUser' });

  // Review Associations
  Review.belongsTo(User, { foreignKey: 'createdBy' });
  Review.belongsTo(User, { foreignKey: 'updatedBy' });

  // Booking Associations
  Booking.belongsTo(Guest, { foreignKey: 'guestId' });
  Booking.belongsTo(Channel, { foreignKey: 'channelId' });
  Booking.belongsTo(User, { foreignKey: 'createdBy' });
  Booking.belongsTo(User, { foreignKey: 'updatedBy' });

  // Guest Associations
  Guest.hasMany(Booking, { foreignKey: 'guestId' });
  Guest.belongsTo(User, { foreignKey: 'createdBy' });
  Guest.belongsTo(User, { foreignKey: 'updatedBy' });

  // Channel Associations
  Channel.hasMany(Booking, { foreignKey: 'channelId' });
  Channel.belongsTo(User, { foreignKey: 'createdBy' });
  Channel.belongsTo(User, { foreignKey: 'updatedBy' });

}
