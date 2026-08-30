import { Sequelize } from "sequelize-typescript";
import dotenv from "dotenv";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import BookingAddon from "../models/BookingAddon.js";
import BookingEmail from "../models/BookingEmail.js";
import BookingEvent from "../models/BookingEvent.js";
import EmailTemplate from "../models/EmailTemplate.js";
import Channel from "../models/Channel.js";
import Guest from "../models/Guest.js";
import Review from "../models/Review.js";
import Counter from "../models/Counter.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import Product from "../models/Product.js";
import ProductType from "../models/ProductType.js";
import UserType from "../models/UserType.js";
import UserTypeProductType from "../models/UserTypeProductType.js";
import ProductAlias from "../models/ProductAlias.js";
import Page from "../models/Page.js";
import Module from "../models/Module.js";
import Action from "../models/Action.js";
import ModuleAction from "../models/ModuleAction.js";
import RolePagePermission from "../models/RolePagePermission.js";
import RoleModulePermission from "../models/RoleModulePermission.js";
import Addon from "../models/Addon.js";
import ProductAddon from "../models/ProductAddon.js";
import StorefrontOrder from "../models/StorefrontOrder.js";
import StorefrontOrderItem from "../models/StorefrontOrderItem.js";
import StorefrontPromotion from "../models/StorefrontPromotion.js";
import StorefrontSavedCart from "../models/StorefrontSavedCart.js";
import StorefrontOngoingCart from "../models/StorefrontOngoingCart.js";
import StorefrontJourneyVisit from "../models/StorefrontJourneyVisit.js";
import StorefrontJourneyEvent from "../models/StorefrontJourneyEvent.js";
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
import StaffPayoutReceipt from "../models/StaffPayoutReceipt.js";
import StaffPayoutReceiptItem from "../models/StaffPayoutReceiptItem.js";
import StaffPayoutSettlementRequest from "../models/StaffPayoutSettlementRequest.js";
import ShiftType from "../models/ShiftType.js";
import ShiftTypeProduct from "../models/ShiftTypeProduct.js";
import ShiftTemplate from "../models/ShiftTemplate.js";
import ScheduleWeek from "../models/ScheduleWeek.js";
import ShiftInstance from "../models/ShiftInstance.js";
import Availability from "../models/Availability.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import SwapRequest from "../models/SwapRequest.js";
import Export from "../models/Export.js";
import Notification from "../models/Notification.js";
import AuditLog from "../models/AuditLog.js";
import RequiredAction from "../models/RequiredAction.js";
import RequiredActionCompletion from "../models/RequiredActionCompletion.js";
import CustomerEmailThreadParticipant from "../models/CustomerEmailThreadParticipant.js";
import CustomerEmailInspection from "../models/CustomerEmailInspection.js";
import WhatsAppMessage from "../models/WhatsAppMessage.js";
import WhatsAppSourceState from "../models/WhatsAppSourceState.js";
import WhatsAppWebhookInbox from "../models/WhatsAppWebhookInbox.js";
import WhatsAppEmbeddedSignupAttempt from "../models/WhatsAppEmbeddedSignupAttempt.js";
import ConfigKey from "../models/ConfigKey.js";
import ConfigValue from "../models/ConfigValue.js";
import ConfigHistory from "../models/ConfigHistory.js";
import ConfigSeedRun from "../models/ConfigSeedRun.js";
import SeoActionLog from "../models/SeoActionLog.js";
import BookingUtmCatalog from "../models/BookingUtmCatalog.js";
import AffiliatePayoutLog from "../models/AffiliatePayoutLog.js";
import ShiftRole from "../models/ShiftRole.js";
import UserShiftRole from "../models/UserShiftRole.js";
import UserTypeMembershipPeriod from "../models/UserTypeMembershipPeriod.js";
import UserShiftRoleMembershipPeriod from "../models/UserShiftRoleMembershipPeriod.js";
import StaffProfileTypePeriod from "../models/StaffProfileTypePeriod.js";
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
import ReviewArchive from "../models/ReviewArchive.js";
import ReviewAssignment from "../models/ReviewAssignment.js";
import ReviewSyncRun from "../models/ReviewSyncRun.js";
import ReviewManualCredit from "../models/ReviewManualCredit.js";
import ReviewDailySnapshot from "../models/ReviewDailySnapshot.js";
import ReviewMonthLock from "../models/ReviewMonthLock.js";
import CompensationComponent from "../models/CompensationComponent.js";
import CompensationComponentAssignment from "../models/CompensationComponentAssignment.js";
import CompensationSettlementRule from "../models/CompensationSettlementRule.js";
import AssistantManagerTaskTemplate from "../models/AssistantManagerTaskTemplate.js";
import AssistantManagerTaskAssignment from "../models/AssistantManagerTaskAssignment.js";
import AssistantManagerTaskLog from "../models/AssistantManagerTaskLog.js";
import AssistantManagerTaskPushSubscription from "../models/AssistantManagerTaskPushSubscription.js";
import OpenBarIngredient from "../models/OpenBarIngredient.js";
import OpenBarIngredientCategory from "../models/OpenBarIngredientCategory.js";
import OpenBarIngredientVariant from "../models/OpenBarIngredientVariant.js";
import OpenBarRecipe from "../models/OpenBarRecipe.js";
import OpenBarRecipeIngredient from "../models/OpenBarRecipeIngredient.js";
import OpenBarDrinkLabelSetting from "../models/OpenBarDrinkLabelSetting.js";
import OpenBarSessionType from "../models/OpenBarSessionType.js";
import OpenBarSession from "../models/OpenBarSession.js";
import OpenBarSessionMembership from "../models/OpenBarSessionMembership.js";
import OpenBarDrinkIssue from "../models/OpenBarDrinkIssue.js";
import OpenBarDelivery from "../models/OpenBarDelivery.js";
import OpenBarDeliveryItem from "../models/OpenBarDeliveryItem.js";
import OpenBarInventoryMovement from "../models/OpenBarInventoryMovement.js";
import InventoryItem from "../models/InventoryItem.js";
import AddonInventoryMapping from "../models/AddonInventoryMapping.js";
import InventoryPurchase from "../models/InventoryPurchase.js";
import InventoryPurchaseItem from "../models/InventoryPurchaseItem.js";
import InventoryMovement from "../models/InventoryMovement.js";
import InventoryFulfillment from "../models/InventoryFulfillment.js";
import CerebroSection from "../models/CerebroSection.js";
import CerebroEntry from "../models/CerebroEntry.js";
import CerebroQuiz from "../models/CerebroQuiz.js";
import CerebroQuizAttempt from "../models/CerebroQuizAttempt.js";
import CerebroAcknowledgement from "../models/CerebroAcknowledgement.js";
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
  VolunteerFund,
  VolunteerFundEntry,
} from "../finance/models/index.js";
import { queryDiagnosticsService } from "../services/queryDiagnosticsService.js";

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
  benchmark: true,
  logging: (sql: string, timing?: number) => {
    // Sequelize may inline bind values in diagnostic SQL. WhatsApp rows contain
    // short-lived customer content, so never retain those statements in the
    // longer-lived query diagnostics buffer.
    if (/\bwhatsapp_(?:messages|source_state|webhook_inbox)\b/i.test(sql)) {
      return;
    }
    queryDiagnosticsService.recordQuery(sql, timing);
  },
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
    EmailTemplate,
    Channel,
    ChannelCommission,
    ChannelProductPrice,
    Guest,
    Review,
    ReviewCounter,
    ReviewCounterEntry,
    ReviewCounterMonthlyApproval,
    ReviewPlatform,
    ReviewArchive,
    ReviewAssignment,
    ReviewSyncRun,
    ReviewManualCredit,
    ReviewDailySnapshot,
    ReviewMonthLock,
    CompensationComponent,
    CompensationComponentAssignment,
    CompensationSettlementRule,
    AssistantManagerTaskTemplate,
    AssistantManagerTaskAssignment,
    AssistantManagerTaskLog,
    AssistantManagerTaskPushSubscription,
    OpenBarIngredient,
    OpenBarIngredientCategory,
    OpenBarIngredientVariant,
    OpenBarRecipe,
    OpenBarRecipeIngredient,
    OpenBarDrinkLabelSetting,
    OpenBarSessionType,
    OpenBarSession,
    OpenBarSessionMembership,
    OpenBarDrinkIssue,
    OpenBarDelivery,
    OpenBarDeliveryItem,
    OpenBarInventoryMovement,
    InventoryItem,
    AddonInventoryMapping,
    InventoryPurchase,
    InventoryPurchaseItem,
    InventoryMovement,
    InventoryFulfillment,
    CerebroSection,
    CerebroEntry,
    CerebroQuiz,
    CerebroQuizAttempt,
    CerebroAcknowledgement,
    Counter,
    CounterProduct,
    CounterUser,
    CounterChannelMetric,
    Product,
    ProductAlias,
    ProductAddon,
    ProductType,
    Addon,
    StorefrontOrder,
    StorefrontOrderItem,
    StorefrontPromotion,
    StorefrontSavedCart,
    StorefrontOngoingCart,
    StorefrontJourneyVisit,
    StorefrontJourneyEvent,
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
    StaffPayoutReceipt,
    StaffPayoutReceiptItem,
    StaffPayoutSettlementRequest,
    ShiftType,
    ShiftTypeProduct,
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
    RequiredAction,
    RequiredActionCompletion,
    CustomerEmailThreadParticipant,
    CustomerEmailInspection,
    WhatsAppMessage,
    WhatsAppSourceState,
    WhatsAppWebhookInbox,
    WhatsAppEmbeddedSignupAttempt,
    ConfigKey,
    ConfigValue,
    ConfigHistory,
    ConfigSeedRun,
    SeoActionLog,
    BookingUtmCatalog,
    AffiliatePayoutLog,
    ShiftRole,
    UserShiftRole,
    UserTypeMembershipPeriod,
    UserShiftRoleMembershipPeriod,
    StaffProfileTypePeriod,
    UserType,
    UserTypeProductType,
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
    VolunteerFund,
    VolunteerFundEntry,
  ],
});

sequelize.authenticate()
  .then(() => console.log("Database connection successful"))
  .catch(err => console.error("Database connection error:", err));

export default sequelize;
