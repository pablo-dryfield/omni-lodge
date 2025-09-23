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
import Page from './Page.js';
import Module from './Module.js';
import Action from './Action.js';
import ModuleAction from './ModuleAction.js';
import RolePagePermission from './RolePagePermission.js';
import RoleModulePermission from './RoleModulePermission.js';

export function defineAssociations() {
  // User Associations
  User.belongsTo(UserType, { foreignKey: 'userTypeId', as: 'role' });

  // UserType Associations
  UserType.hasMany(User, { foreignKey: 'userTypeId', as: 'users' });
  UserType.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  UserType.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });
  UserType.hasMany(RolePagePermission, { foreignKey: 'userTypeId', as: 'pagePermissions' });
  UserType.hasMany(RoleModulePermission, { foreignKey: 'userTypeId', as: 'modulePermissions' });

  // Access Control Associations
  Page.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  Page.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });
  Page.hasMany(Module, { foreignKey: 'pageId', as: 'modules' });
  Page.hasMany(RolePagePermission, { foreignKey: 'pageId', as: 'rolePermissions' });

  Module.belongsTo(Page, { foreignKey: 'pageId', as: 'page' });
  Module.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  Module.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });
  Module.hasMany(ModuleAction, { foreignKey: 'moduleId', as: 'moduleActions' });
  Module.hasMany(RoleModulePermission, { foreignKey: 'moduleId', as: 'rolePermissions' });

  Action.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  Action.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });
  Action.hasMany(ModuleAction, { foreignKey: 'actionId', as: 'moduleActions' });
  Action.hasMany(RoleModulePermission, { foreignKey: 'actionId', as: 'roleAssignments' });

  ModuleAction.belongsTo(Module, { foreignKey: 'moduleId', as: 'module' });
  ModuleAction.belongsTo(Action, { foreignKey: 'actionId', as: 'action' });
  ModuleAction.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  ModuleAction.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });

  RolePagePermission.belongsTo(UserType, { foreignKey: 'userTypeId', as: 'role' });
  RolePagePermission.belongsTo(Page, { foreignKey: 'pageId', as: 'page' });
  RolePagePermission.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  RolePagePermission.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });

  RoleModulePermission.belongsTo(UserType, { foreignKey: 'userTypeId', as: 'role' });
  RoleModulePermission.belongsTo(Module, { foreignKey: 'moduleId', as: 'module' });
  RoleModulePermission.belongsTo(Action, { foreignKey: 'actionId', as: 'action' });
  RoleModulePermission.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  RoleModulePermission.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });

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
  CounterUser.belongsTo(Counter, { foreignKey: 'counterId', onDelete: 'CASCADE', as: 'counter'});
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

