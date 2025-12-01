import Booking from './Booking.js';
import Channel from './Channel.js';
import Counter from './Counter.js';
import CounterProduct from './CounterProduct.js';
import CounterUser from './CounterUser.js';
import Guest from './Guest.js';
import Product from './Product.js';
import ProductType from './ProductType.js';
import Review from './Review.js';
import ReviewCounter from './ReviewCounter.js';
import ReviewCounterEntry from './ReviewCounterEntry.js';
import ReviewCounterMonthlyApproval from './ReviewCounterMonthlyApproval.js';
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
import Venue from './Venue.js';
import VenueCompensationTerm from './VenueCompensationTerm.js';
import VenueCompensationTermRate from './VenueCompensationTermRate.js';
import VenueCompensationCollectionLog from './VenueCompensationCollectionLog.js';
import VenueCompensationLedger from './VenueCompensationLedger.js';
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
import StaffPayoutCollectionLog from './StaffPayoutCollectionLog.js';
import StaffPayoutLedger from './StaffPayoutLedger.js';
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
import ShiftRole from './ShiftRole.js';
import UserShiftRole from './UserShiftRole.js';
import ReportTemplate from './ReportTemplate.js';
import ReportSchedule from './ReportSchedule.js';
import DerivedFieldDefinition from './DerivedFieldDefinition.js';
import ReportDashboard from './ReportDashboard.js';
import ReportDashboardCard from './ReportDashboardCard.js';
import UserHomePreference from './UserHomePreference.js';
import CompensationComponent from './CompensationComponent.js';
import CompensationComponentAssignment from './CompensationComponentAssignment.js';
import AssistantManagerTaskTemplate from './AssistantManagerTaskTemplate.js';
import AssistantManagerTaskAssignment from './AssistantManagerTaskAssignment.js';
import AssistantManagerTaskLog from './AssistantManagerTaskLog.js';

export function defineAssociations() {
  // User Associations
  User.belongsTo(UserType, { foreignKey: 'userTypeId', as: 'role' });
  User.hasOne(StaffProfile, { foreignKey: 'user_id', as: 'staffProfile' });
  User.hasMany(ReportTemplate, { foreignKey: 'userId', as: 'reportTemplates' });
  User.hasMany(ReportDashboard, { foreignKey: 'ownerId', as: 'reportDashboards' });
  User.hasOne(UserHomePreference, { foreignKey: 'userId', as: 'homePreference' });
  ReportTemplate.belongsTo(User, { foreignKey: 'userId', as: 'reportOwner' });
  ReportDashboard.belongsTo(User, { foreignKey: 'ownerId', as: 'dashboardOwner' });
  UserHomePreference.belongsTo(User, { foreignKey: 'userId', as: 'userHome' });
  User.hasMany(CompensationComponent, { foreignKey: 'created_by', as: 'compensationComponentsCreated' });
  User.hasMany(CompensationComponent, { foreignKey: 'updated_by', as: 'compensationComponentsUpdated' });
  User.hasMany(CompensationComponentAssignment, { foreignKey: 'user_id', as: 'compensationAssignments' });
  CompensationComponentAssignment.belongsTo(User, { foreignKey: 'user_id', as: 'userCompensation' });
  User.hasMany(StaffPayoutLedger, { foreignKey: 'staff_user_id', as: 'payoutLedgers' });
  StaffPayoutLedger.belongsTo(User, { foreignKey: 'staff_user_id', as: 'ledgerUser' });

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

  // Compensation components
  CompensationComponent.hasMany(CompensationComponentAssignment, { foreignKey: 'component_id', as: 'assignmentsCompensation' });
  CompensationComponentAssignment.belongsTo(CompensationComponent, { foreignKey: 'component_id', as: 'componentCompensation' });
  ShiftRole.hasMany(CompensationComponentAssignment, { foreignKey: 'shift_role_id', as: 'shiftRoleCompensationAssignments' });
  CompensationComponentAssignment.belongsTo(ShiftRole, { foreignKey: 'shift_role_id', as: 'shiftRoleCompensation' });
  UserType.hasMany(CompensationComponentAssignment, { foreignKey: 'user_type_id', as: 'userTypeCompensationAssignments' });
  CompensationComponentAssignment.belongsTo(UserType, { foreignKey: 'user_type_id', as: 'userTypeCompensation' });

  AssistantManagerTaskTemplate.hasMany(AssistantManagerTaskAssignment, { foreignKey: 'template_id', as: 'taskAssignments' });
  AssistantManagerTaskAssignment.belongsTo(AssistantManagerTaskTemplate, { foreignKey: 'template_id', as: 'templateTask' });
  AssistantManagerTaskTemplate.hasMany(AssistantManagerTaskLog, { foreignKey: 'template_id', as: 'taskLogs' });
  AssistantManagerTaskLog.belongsTo(AssistantManagerTaskTemplate, { foreignKey: 'template_id', as: 'templateTaskLog' });
  User.hasMany(AssistantManagerTaskAssignment, { foreignKey: 'user_id', as: 'assistantManagerTaskAssignments' });
  AssistantManagerTaskAssignment.belongsTo(User, { foreignKey: 'user_id', as: 'assignmentUser' });
  User.hasMany(AssistantManagerTaskLog, { foreignKey: 'user_id', as: 'assistantManagerTaskLogs' });
  AssistantManagerTaskLog.belongsTo(User, { foreignKey: 'user_id', as: 'logUser' });

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
  ReviewCounter.belongsTo(User, { foreignKey: 'created_by', as: 'createdByUserReview' });
  ReviewCounter.belongsTo(User, { foreignKey: 'updated_by', as: 'updatedByUserReview' });
  ReviewCounter.hasMany(ReviewCounterEntry, { foreignKey: 'counter_id', as: 'entriesReviewCounters' });
  ReviewCounterEntry.belongsTo(ReviewCounter, { foreignKey: 'counter_id', as: 'counterReviewCounters' });
  ReviewCounterEntry.belongsTo(User, { foreignKey: 'user_id', as: 'userReviewCounters' });
  ReviewCounterEntry.belongsTo(User, { foreignKey: 'created_by', as: 'createdByUserReviewCounters' });
  ReviewCounterEntry.belongsTo(User, { foreignKey: 'updated_by', as: 'updatedByUserReviewCounters' });
  User.hasMany(ReviewCounterMonthlyApproval, { foreignKey: 'user_id', as: 'reviewMonthlyApprovals' });

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

  // Reporting engine associations
  ReportTemplate.hasMany(ReportSchedule, { foreignKey: 'templateId', as: 'schedules' });
  ReportSchedule.belongsTo(ReportTemplate, { foreignKey: 'templateId', as: 'templateReport' });
  ReportTemplate.hasMany(DerivedFieldDefinition, { foreignKey: 'templateId', as: 'derivedFieldDefs' });
  DerivedFieldDefinition.belongsTo(ReportTemplate, { foreignKey: 'templateId', as: 'templateDerived' });
  ReportDashboard.hasMany(ReportDashboardCard, { foreignKey: 'dashboardId', as: 'cardsDashboard' });
  ReportDashboardCard.belongsTo(ReportDashboard, { foreignKey: 'dashboardId', as: 'dashboardDashboard' });
  ReportTemplate.hasMany(ReportDashboardCard, { foreignKey: 'templateId', as: 'dashboardCards' });
  ReportDashboardCard.belongsTo(ReportTemplate, { foreignKey: 'templateId', as: 'templateDashboard' });

  // Night Report Associations
  Counter.hasOne(NightReport, { foreignKey: 'counterId', as: 'nightReport', onDelete: 'CASCADE', hooks: true });
  NightReportVenue.belongsTo(NightReport, { foreignKey: 'reportId', as: 'report', onDelete: 'CASCADE' });
  NightReportPhoto.belongsTo(NightReport, { foreignKey: 'reportId', as: 'report', onDelete: 'CASCADE' });
  Venue.hasMany(VenueCompensationTerm, { foreignKey: 'venue_id', as: 'compensationTerms' });
  VenueCompensationTerm.belongsTo(Venue, { foreignKey: 'venue_id', as: 'venueCompTermVenue' });
  VenueCompensationTerm.hasMany(VenueCompensationTermRate, { foreignKey: 'term_id', as: 'rateBands' });
  VenueCompensationTermRate.belongsTo(VenueCompensationTerm, { foreignKey: 'term_id', as: 'rateTerm' });
  VenueCompensationTermRate.belongsTo(Product, { foreignKey: 'product_id', as: 'rateProduct' });
  Venue.hasMany(NightReportVenue, { foreignKey: 'venue_id', as: 'nightReportEntries' });
  NightReportVenue.belongsTo(Venue, { foreignKey: 'venue_id', as: 'nightReportVenueVenue' });
  NightReportVenue.belongsTo(VenueCompensationTerm, { foreignKey: 'compensation_term_id', as: 'compensationTermReportVenue' });
  Venue.hasMany(VenueCompensationCollectionLog, { foreignKey: 'venue_id', as: 'collectionLogs' });
  VenueCompensationCollectionLog.belongsTo(Venue, { foreignKey: 'venue_id', as: 'logVenue' });
  Venue.hasMany(VenueCompensationLedger, { foreignKey: 'venue_id', as: 'compensationLedgers' });

  // Finance associations
  FinanceVendor.hasMany(Venue, { foreignKey: 'finance_vendor_id', as: 'venues' });
  FinanceClient.hasMany(Venue, { foreignKey: 'finance_client_id', as: 'venues' });
  FinanceVendor.hasMany(StaffProfile, { foreignKey: 'finance_vendor_id', as: 'staffProfiles' });
  FinanceClient.hasMany(StaffProfile, { foreignKey: 'finance_client_id', as: 'staffProfiles' });
  FinanceAccount.hasMany(FinanceTransaction, { foreignKey: 'accountId', as: 'transactions' });
  FinanceCategory.hasMany(FinanceTransaction, { foreignKey: 'categoryId', as: 'transactions' });
  FinanceAccount.hasMany(CompensationComponent, {
    foreignKey: 'default_finance_account_id',
    as: 'defaultAccountCompensationComponents',
  });
  FinanceCategory.hasMany(CompensationComponent, {
    foreignKey: 'default_finance_category_id',
    as: 'defaultCategoryCompensationComponents',
  });
  FinanceCategory.hasMany(FinanceVendor, { foreignKey: 'defaultCategoryId', as: 'vendors' });
  FinanceCategory.hasMany(FinanceClient, { foreignKey: 'defaultCategoryId', as: 'clients' });

  // Scheduling associations are defined via model decorators
}


