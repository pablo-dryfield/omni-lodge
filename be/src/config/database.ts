import { Sequelize } from "sequelize-typescript";
import dotenv from "dotenv";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import BookingAddon from "../models/BookingAddon.js";
import BookingEmail from "../models/BookingEmail.js";
import BookingEvent from "../models/BookingEvent.js";
import Channel from "../models/Channel.js";
import Guest from "../models/Guest.js";
import Review from "../models/Review.js";
import Counter from "../models/Counter.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import Product from "../models/Product.js";
import ProductType from "../models/ProductType.js";
import UserType from "../models/UserType.js";
import Page from "../models/Page.js";
import Module from "../models/Module.js";
import Action from "../models/Action.js";
import ModuleAction from "../models/ModuleAction.js";
import RolePagePermission from "../models/RolePagePermission.js";
import RoleModulePermission from "../models/RoleModulePermission.js";
import Addon from "../models/Addon.js";
import ProductAddon from "../models/ProductAddon.js";
import CounterChannelMetric from "../models/CounterChannelMetric.js";
import PaymentMethod from "../models/PaymentMethod.js";
import ProductPrice from "../models/ProductPrice.js";
import ChannelCommission from "../models/ChannelCommission.js";
import ChannelProductPrice from "../models/ChannelProductPrice.js";
import NightReport from "../models/NightReport.js";
import NightReportVenue from "../models/NightReportVenue.js";
import NightReportPhoto from "../models/NightReportPhoto.js";
import Venue from "../models/Venue.js";
import VenueCompensationTerm from "../models/VenueCompensationTerm.js";
import VenueCompensationTermRate from "../models/VenueCompensationTermRate.js";
import VenueCompensationCollectionLog from "../models/VenueCompensationCollectionLog.js";
import VenueCompensationLedger from "../models/VenueCompensationLedger.js";
import ChannelCashCollectionLog from "../models/ChannelCashCollectionLog.js";
import StaffProfile from "../models/StaffProfile.js";
import StaffPayoutCollectionLog from "../models/StaffPayoutCollectionLog.js";
import StaffPayoutLedger from "../models/StaffPayoutLedger.js";
import ShiftType from "../models/ShiftType.js";
import ShiftTemplate from "../models/ShiftTemplate.js";
import ScheduleWeek from "../models/ScheduleWeek.js";
import ShiftInstance from "../models/ShiftInstance.js";
import Availability from "../models/Availability.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import SwapRequest from "../models/SwapRequest.js";
import Export from "../models/Export.js";
import Notification from "../models/Notification.js";
import AuditLog from "../models/AuditLog.js";
import ConfigKey from "../models/ConfigKey.js";
import ConfigValue from "../models/ConfigValue.js";
import ConfigHistory from "../models/ConfigHistory.js";
import ConfigSeedRun from "../models/ConfigSeedRun.js";
import ShiftRole from "../models/ShiftRole.js";
import UserShiftRole from "../models/UserShiftRole.js";
import ReportTemplate from "../models/ReportTemplate.js";
import ReportSchedule from "../models/ReportSchedule.js";
import DerivedFieldDefinition from "../models/DerivedFieldDefinition.js";
import ReportQueryCacheEntry from "../models/ReportQueryCacheEntry.js";
import ReportDashboard from "../models/ReportDashboard.js";
import ReportDashboardCard from "../models/ReportDashboardCard.js";
import ReportAsyncJob from "../models/ReportAsyncJob.js";
import UserHomePreference from "../models/UserHomePreference.js";
import GameScore from "../models/GameScore.js";
import ReviewCounter from "../models/ReviewCounter.js";
import ReviewCounterEntry from "../models/ReviewCounterEntry.js";
import ReviewPlatform from "../models/ReviewPlatform.js";
import ReviewCounterMonthlyApproval from "../models/ReviewCounterMonthlyApproval.js";
import CompensationComponent from "../models/CompensationComponent.js";
import CompensationComponentAssignment from "../models/CompensationComponentAssignment.js";
import AssistantManagerTaskTemplate from "../models/AssistantManagerTaskTemplate.js";
import AssistantManagerTaskAssignment from "../models/AssistantManagerTaskAssignment.js";
import AssistantManagerTaskLog from "../models/AssistantManagerTaskLog.js";
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
} from "../finance/models/index.js";

const environment = (process.env.NODE_ENV || "development").trim();
const envFile = environment === "production" ? ".env.prod" : ".env.dev";
const configResult = dotenv.config({ path: envFile });

if (configResult.error) {
  console.warn(`dotenv: failed to load ${envFile}. Falling back to existing process.env values.`);
} else {
  console.log(`dotenv: loaded ${envFile} for NODE_ENV=${environment}`);
}

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER) {
  console.warn("Database configuration is incomplete. Check DB_HOST, DB_PORT, DB_NAME, DB_USER environment variables.");
}

const sequelize = new Sequelize({
  database: DB_NAME,
  dialect: "postgres",
  username: DB_USER,
  password: DB_PASSWORD,
  host: DB_HOST,
  port: parseInt(DB_PORT || "5432", 10),
  logging: false,
  dialectOptions: {
    ssl: false,
  },
  models: [
    User,
    PaymentMethod,
    ProductPrice,
    Booking,
    BookingAddon,
    BookingEmail,
    BookingEvent,
    Channel,
    ChannelCommission,
    ChannelProductPrice,
    Guest,
    Review,
    ReviewCounter,
    ReviewCounterEntry,
    ReviewCounterMonthlyApproval,
    ReviewPlatform,
    CompensationComponent,
    CompensationComponentAssignment,
    AssistantManagerTaskTemplate,
    AssistantManagerTaskAssignment,
    AssistantManagerTaskLog,
    Counter,
    CounterProduct,
    CounterUser,
    CounterChannelMetric,
    Product,
    ProductAddon,
    ProductType,
    Addon,
    Venue,
    VenueCompensationTerm,
    VenueCompensationTermRate,
    VenueCompensationCollectionLog,
    VenueCompensationLedger,
    ChannelCashCollectionLog,
    NightReport,
    NightReportVenue,
    NightReportPhoto,
    StaffProfile,
    StaffPayoutCollectionLog,
    StaffPayoutLedger,
    ShiftType,
    ShiftTemplate,
    ScheduleWeek,
    ShiftInstance,
    Availability,
    ShiftAssignment,
    SwapRequest,
    ReportTemplate,
    ReportSchedule,
    DerivedFieldDefinition,
    ReportQueryCacheEntry,
    ReportDashboard,
    ReportDashboardCard,
    ReportAsyncJob,
    UserHomePreference,
    GameScore,
    Export,
    Notification,
    AuditLog,
    ConfigKey,
    ConfigValue,
    ConfigHistory,
    ConfigSeedRun,
    ShiftRole,
    UserShiftRole,
    UserType,
    Page,
    Module,
    Action,
    ModuleAction,
    RolePagePermission,
    RoleModulePermission,
    FinanceAccount,
    FinanceCategory,
    FinanceVendor,
    FinanceClient,
    FinanceFile,
    FinanceTransaction,
    FinanceRecurringRule,
    FinanceManagementRequest,
    FinanceBudget,
    FinanceAuditLog,
  ],
});

sequelize.authenticate()
  .then(() => console.log("Database connection successful"))
  .catch(err => console.error("Database connection error:", err));

export default sequelize;
