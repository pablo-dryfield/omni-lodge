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
import PaymentMethod from './PaymentMethod.js';
import NightReport from './NightReport.js';
import NightReportVenue from './NightReportVenue.js';
import NightReportPhoto from './NightReportPhoto.js';
import {
  FinanceAccount,
  FinanceAuditLog,
  FinanceBudget,
  FinanceCategory,
  FinanceClient,
  FinanceFile,
  FinanceManagementRequest,
  FinanceRecurringRule,
  FinanceTransaction,
  FinanceVendor,
} from '../finance/models/index.js';
import StaffProfile from './StaffProfile.js';
import ShiftType from './ShiftType.js';
import ShiftTemplate from './ShiftTemplate.js';
import ScheduleWeek from './ScheduleWeek.js';
import ShiftInstance from './ShiftInstance.js';
import Availability from './Availability.js';
import ShiftAssignment from './ShiftAssignment.js';
import SwapRequest from './SwapRequest.js';
import Export from './Export.js';
import Notification from './Notification.js';
import AuditLog from './AuditLog.js';

export function defineAssociations() {
  // User Associations
  User.belongsTo(UserType, { foreignKey: 'userTypeId', as: 'role' });
  User.hasOne(StaffProfile, { foreignKey: 'user_id', as: 'staffProfile' });
  StaffProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

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
  Counter.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });
  Counter.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser' });

  // CounterProduct Associations
  CounterProduct.belongsTo(Counter, { foreignKey: 'counterId', as: 'counterProductCounterId', onDelete: 'CASCADE' });
  CounterProduct.belongsTo(Product, { foreignKey: 'productId', as: 'counterProductProductId' });
  CounterProduct.belongsTo(User, { foreignKey: 'createdBy', as: 'counterProductCreatedByUser' });
  CounterProduct.belongsTo(User, { foreignKey: 'updatedBy', as: 'counterProductUpdatedByUser' });

  // CounterUser Associations
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
  // Payment Method associations are defined via decorators on the models

  // Night Report Associations
  Counter.hasOne(NightReport, { foreignKey: 'counterId', as: 'nightReport', onDelete: 'CASCADE', hooks: true });
  NightReportVenue.belongsTo(NightReport, { foreignKey: 'reportId', as: 'report', onDelete: 'CASCADE' });
  NightReportPhoto.belongsTo(NightReport, { foreignKey: 'reportId', as: 'report', onDelete: 'CASCADE' });

  // Finance associations
  FinanceAccount.hasMany(FinanceTransaction, { foreignKey: 'accountId', as: 'transactions' });
  FinanceCategory.hasMany(FinanceTransaction, { foreignKey: 'categoryId', as: 'transactions' });
  FinanceCategory.hasMany(FinanceVendor, { foreignKey: 'defaultCategoryId', as: 'vendors' });
  FinanceCategory.hasMany(FinanceClient, { foreignKey: 'defaultCategoryId', as: 'clients' });

  // Scheduling associations
  ShiftType.hasMany(ShiftTemplate, { foreignKey: 'shift_type_id', as: 'templates' });
  ShiftType.hasMany(ShiftInstance, { foreignKey: 'shift_type_id', as: 'instances' });
  ShiftTemplate.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });
  ShiftTemplate.hasMany(ShiftInstance, { foreignKey: 'shift_template_id', as: 'instances' });
  ScheduleWeek.hasMany(ShiftInstance, { foreignKey: 'schedule_week_id', as: 'shiftInstances' });
  ScheduleWeek.hasMany(Availability, { foreignKey: 'schedule_week_id', as: 'availabilities' });
  ScheduleWeek.hasMany(Export, { foreignKey: 'schedule_week_id', as: 'exports' });
  ShiftInstance.belongsTo(ScheduleWeek, { foreignKey: 'schedule_week_id', as: 'scheduleWeek' });
  ShiftInstance.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });
  ShiftInstance.belongsTo(ShiftTemplate, { foreignKey: 'shift_template_id', as: 'template' });
  ShiftInstance.hasMany(ShiftAssignment, { foreignKey: 'shift_instance_id', as: 'assignments' });
  ShiftAssignment.belongsTo(ShiftInstance, { foreignKey: 'shift_instance_id', as: 'shiftInstance' });
  ShiftAssignment.belongsTo(User, { foreignKey: 'user_id', as: 'assignee' });
  ShiftAssignment.hasMany(SwapRequest, { foreignKey: 'from_assignment_id', as: 'outgoingSwapRequests' });
  ShiftAssignment.hasMany(SwapRequest, { foreignKey: 'to_assignment_id', as: 'incomingSwapRequests' });
  SwapRequest.belongsTo(ShiftAssignment, { foreignKey: 'from_assignment_id', as: 'fromAssignment' });
  SwapRequest.belongsTo(ShiftAssignment, { foreignKey: 'to_assignment_id', as: 'toAssignment' });
  SwapRequest.belongsTo(User, { foreignKey: 'requester_id', as: 'requester' });
  SwapRequest.belongsTo(User, { foreignKey: 'partner_id', as: 'partner' });
  SwapRequest.belongsTo(User, { foreignKey: 'manager_id', as: 'manager' });
  Availability.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  Availability.belongsTo(ScheduleWeek, { foreignKey: 'schedule_week_id', as: 'scheduleWeek' });
  Availability.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'preferredShiftType' });
  Export.belongsTo(ScheduleWeek, { foreignKey: 'schedule_week_id', as: 'scheduleWeek' });
  Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  AuditLog.belongsTo(User, { foreignKey: 'actor_id', as: 'actor' });
}


