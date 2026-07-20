import { lazy, Suspense } from "react";
import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes as ReactRoutes } from "react-router-dom";
import { lazyRoute } from "../../store/lazyRoute";
import {
  loadAssistantManagerTaskReducers,
  loadBookingsReducers,
  loadChannelNumbersReducers,
  loadCountersReducers,
  loadFinanceReducers,
  loadGuestsReducers,
  loadMyAccountReducers,
  loadPaysReducers,
  loadReportsReducers,
  loadReviewCountersReducers,
  loadSettingsReducers,
  loadVenueNumbersReducers,
} from "../../store/routeReducers";

const Home = lazy(() => import("../../pages/Home"));
const Guests = lazyRoute(() => import("../../pages/Guests"), loadGuestsReducers);
const BookingsPage = lazyRoute(() => import("../../pages/BookingsPage"), loadBookingsReducers);
const BookingsManifestPage = lazyRoute(() => import("../../pages/BookingsManifestPage"), loadBookingsReducers);
const AvailabilityCalendar = lazy(() => import("../../pages/AvailabilityCalendar"));
const Counters = lazyRoute(() => import("../../pages/Counters"), loadCountersReducers);
const VenueNumbers = lazyRoute(() => import("../../pages/VenueNumbers"), loadVenueNumbersReducers);
const ChannelNumbers = lazyRoute(() => import("../../pages/ChannelNumbers"), loadChannelNumbersReducers);
const MarketingPage = lazy(() => import("../../pages/MarketingPage"));
const SearchConsolePage = lazy(() => import("../../pages/SearchConsolePage"));
const AffiliatesPage = lazy(() => import("../../pages/AffiliatesPage"));
const PrivacyPolicyPage = lazy(() => import("../../pages/PrivacyPolicyPage"));
const DataDeletionPage = lazy(() => import("../../pages/DataDeletionPage"));
const TermsPage = lazy(() => import("../../pages/TermsPage"));
const PerformancePage = lazy(() => import("../../pages/PerformancePage"));
const Pays = lazyRoute(() => import("../../pages/Pays"), loadPaysReducers);
const ReviewCounters = lazyRoute(() => import("../../pages/ReviewCounters"), loadReviewCountersReducers);
const Reports = lazyRoute(() => import("../../pages/Reports"), loadReportsReducers);
const OpenBarControl = lazy(() => import("../../pages/OpenBarControl"));
const Cerebro = lazy(() => import("../../pages/Cerebro"));
const DerivedFieldsManager = lazy(() => import("../../pages/DerivedFieldsManager"));
const ReportDashboards = lazy(() => import("../../pages/ReportDashboards"));
const MyAccount = lazyRoute(() => import("../../pages/MyAccount"), loadMyAccountReducers);
const SettingsLayout = lazyRoute(() => import("../../pages/settings/SettingsLayout"), loadSettingsReducers);
const SettingsLanding = lazy(() => import("../../pages/settings/SettingsLanding"));
const SettingsUsers = lazy(() => import("../../pages/settings/SettingsUsers"));
const SettingsUserTypes = lazy(() => import("../../pages/settings/SettingsUserTypes"));
const SettingsPermissions = lazy(() => import("../../pages/settings/SettingsPermissions"));
const SettingsProducts = lazy(() => import("../../pages/settings/SettingsProducts"));
const SettingsProductTypes = lazy(() => import("../../pages/settings/SettingsProductTypes"));
const SettingsProductPrices = lazy(() => import("../../pages/settings/SettingsProductPrices"));
const SettingsProductAliases = lazy(() => import("../../pages/settings/SettingsProductAliases"));
const SettingsAddons = lazy(() => import("../../pages/settings/SettingsAddons"));
const SettingsVenues = lazy(() => import("../../pages/settings/SettingsVenues"));
const SettingsProductAddons = lazy(() => import("../../pages/settings/SettingsProductAddons"));
const SettingsPaymentMethods = lazy(() => import("../../pages/settings/SettingsPaymentMethods"));
const SettingsChannelProductPrices = lazy(() => import("../../pages/settings/SettingsChannelProductPrices"));
const SettingsChannelCommissions = lazy(() => import("../../pages/settings/SettingsChannelCommissions"));
const SettingsActions = lazy(() => import("../../pages/settings/SettingsActions"));
const SettingsChannels = lazy(() => import("../../pages/settings/SettingsChannels"));
const SettingsStaffProfiles = lazy(() => import("../../pages/settings/SettingsStaffProfiles"));
const SettingsShiftRoles = lazy(() => import("../../pages/settings/SettingsShiftRoles"));
const SettingsUserShiftRoles = lazy(() => import("../../pages/settings/SettingsUserShiftRoles"));
const SettingsShiftTypes = lazy(() => import("../../pages/settings/SettingsShiftTypes"));
const SettingsSqlHelper = lazy(() => import("../../pages/settings/SettingsSqlHelper"));
const SettingsDbBackups = lazy(() => import("../../pages/settings/SettingsDbBackups"));
const SettingsHomeExperience = lazy(() => import("../../pages/settings/SettingsHomeExperience"));
const SettingsControlPanel = lazy(() => import("../../pages/settings/SettingsControlPanel"));
const SettingsGoogleApi = lazy(() => import("../../pages/settings/SettingsGoogleApi"));
const SettingsMaintenance = lazy(() => import("../../pages/settings/SettingsMaintenance"));
const SettingsReviewPlatforms = lazy(() => import("../../pages/settings/SettingsReviewPlatforms"));
const SettingsCompensationComponents = lazy(() => import("../../pages/settings/SettingsCompensationComponents"));
const AssistantManagerTasks = lazyRoute(
  () => import("../../pages/AssistantManagerTasks"),
  loadAssistantManagerTaskReducers,
);
const SchedulingLayout = lazy(() => import("../../pages/scheduling/SchedulingLayout"));
const AvailabilityPage = lazy(() => import("../../pages/scheduling/AvailabilityPage"));
const BuilderPage = lazy(() => import("../../pages/scheduling/BuilderPage"));
const TemplatesPage = lazy(() => import("../../pages/scheduling/TemplatesPage"));
const ScheduleOverviewPage = lazy(() => import("../../pages/scheduling/ScheduleOverviewPage"));
const MyShiftsPage = lazy(() => import("../../pages/scheduling/MyShiftsPage"));
const SwapsPage = lazy(() => import("../../pages/scheduling/SwapsPage"));
const HistoryPage = lazy(() => import("../../pages/scheduling/HistoryPage"));
const FinanceLayout = lazyRoute(() => import("../../pages/Finance/FinanceLayout"), loadFinanceReducers);
const FinanceDashboard = lazy(() => import("../../pages/Finance/FinanceDashboard"));
const FinanceTransactions = lazy(() => import("../../pages/Finance/FinanceTransactions"));
const FinanceAccounts = lazy(() => import("../../pages/Finance/FinanceAccounts"));
const FinanceVendors = lazy(() => import("../../pages/Finance/FinanceVendors"));
const FinanceClients = lazy(() => import("../../pages/Finance/FinanceClients"));
const FinanceCategories = lazy(() => import("../../pages/Finance/FinanceCategories"));
const FinanceRecurring = lazy(() => import("../../pages/Finance/FinanceRecurring"));
const FinanceBudgets = lazy(() => import("../../pages/Finance/FinanceBudgets"));
const FinanceManagementRequests = lazy(() => import("../../pages/Finance/FinanceManagementRequests"));
const FinanceReports = lazy(() => import("../../pages/Finance/FinanceReports"));
const FinanceFiles = lazy(() => import("../../pages/Finance/FinanceFiles"));
const FinanceSettings = lazy(() => import("../../pages/Finance/FinanceSettings"));
const FinanceRefunds = lazy(() => import("../../pages/Finance/FinanceRefunds"));
const NotificationsCenter = lazy(() => import("../../pages/NotificationsCenter"));

const RouteFallback = () => (
  <Center mih="40vh">
    <Loader variant="dots" />
  </Center>
);

const Routes = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <ReactRoutes>
        <Route path="/" element={<Home title="Home" />} />
        <Route path="/guests" element={<Guests title="Guests" />} />
        <Route path="/bookings" element={<BookingsPage title="Bookings" />} />
        <Route path="/bookings/manifest" element={<BookingsManifestPage title="Bookings Manifest" />} />
        <Route path="/calendar" element={<AvailabilityCalendar />} />
        <Route path="/counters" element={<Counters title="Counters" />} />
        <Route path="/venueNumbers" element={<VenueNumbers title="Venue Numbers" />} />
        <Route path="/channelNumbers" element={<ChannelNumbers title="Channel Numbers" />} />
        <Route path="/marketing" element={<MarketingPage title="Marketing" />} />
        <Route path="/search-console" element={<SearchConsolePage title="Search Console" />} />
        <Route path="/affiliates" element={<AffiliatesPage title="Affiliates" />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage title="Privacy Policy" />} />
        <Route path="/data-deletion" element={<DataDeletionPage title="Data Deletion Request" />} />
        <Route path="/terms" element={<TermsPage title="Terms" />} />
        <Route path="/terms-and-conditions" element={<Navigate to="/terms" replace />} />
        <Route path="/performance" element={<PerformancePage title="Performance" />} />
        <Route path="/reviews" element={<ReviewCounters />} />
        <Route path="/pays" element={<Pays />} />
        <Route path="/cerebro" element={<Cerebro />} />
        <Route path="/assistant-manager-tasks" element={<AssistantManagerTasks />} />
        <Route path="/reports" element={<Reports title={"Reports"} />} />
        <Route path="/open-bar" element={<OpenBarControl title="Open Bar Control" />} />
        <Route path="/reports/open-bar" element={<Navigate to="/open-bar" replace />} />
        <Route path="/reports/derived-fields" element={<DerivedFieldsManager title="Derived fields" />} />
        <Route path="/reports/dashboards" element={<ReportDashboards title="Dashboards" />} />
        <Route path="/account" element={<MyAccount />} />
        <Route path="/notifications" element={<NotificationsCenter title="Notifications" />} />
        <Route path="/scheduling" element={<SchedulingLayout />}>
          <Route index element={<AvailabilityPage />} />
          <Route path="availability" element={<AvailabilityPage />} />
          <Route path="builder" element={<BuilderPage />} />
          <Route path="schedule" element={<ScheduleOverviewPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="my-shifts" element={<MyShiftsPage />} />
          <Route path="swaps" element={<SwapsPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
        <Route path="/finance" element={<FinanceLayout />}>
          <Route index element={<FinanceDashboard />} />
          <Route path="transactions" element={<FinanceTransactions />} />
          <Route path="refunds" element={<FinanceRefunds />} />
          <Route path="accounts" element={<FinanceAccounts />} />
          <Route path="vendors" element={<FinanceVendors />} />
          <Route path="clients" element={<FinanceClients />} />
          <Route path="categories" element={<FinanceCategories />} />
          <Route path="recurring" element={<FinanceRecurring />} />
          <Route path="budgets" element={<FinanceBudgets />} />
          <Route path="management-requests" element={<FinanceManagementRequests />} />
          <Route path="files" element={<FinanceFiles />} />
          <Route path="reports" element={<FinanceReports />} />
          <Route path="settings" element={<FinanceSettings />} />
        </Route>

        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<SettingsLanding />} />
          <Route path="users" element={<SettingsUsers />} />
          <Route path="user-types" element={<SettingsUserTypes />} />
          <Route path="permissions" element={<SettingsPermissions />} />
          <Route path="pages" element={<Navigate to="/settings/permissions" replace />} />
          <Route path="modules" element={<Navigate to="/settings/permissions" replace />} />
          <Route path="permissions/pages" element={<Navigate to="/settings/permissions" replace />} />
          <Route path="permissions/modules" element={<Navigate to="/settings/permissions" replace />} />
          <Route path="products" element={<SettingsProducts />} />
          <Route path="product-aliases" element={<SettingsProductAliases />} />
          <Route path="product-prices" element={<SettingsProductPrices />} />
          <Route path="product-types" element={<SettingsProductTypes />} />
          <Route path="addons" element={<SettingsAddons />} />
          <Route path="venues" element={<SettingsVenues />} />
          <Route path="product-addons" element={<SettingsProductAddons />} />
          <Route path="payment-methods" element={<SettingsPaymentMethods />} />
          <Route path="channel-product-prices" element={<SettingsChannelProductPrices />} />
          <Route path="channel-commissions" element={<SettingsChannelCommissions />} />
          <Route path="actions" element={<SettingsActions />} />
          <Route path="sql-helper" element={<SettingsSqlHelper />} />
          <Route path="db-backups" element={<SettingsDbBackups />} />
          <Route path="channels" element={<SettingsChannels />} />
          <Route path="staff-profiles" element={<SettingsStaffProfiles />} />
          <Route path="shift-roles" element={<SettingsShiftRoles />} />
          <Route path="shift-types" element={<SettingsShiftTypes />} />
          <Route path="user-shift-roles" element={<SettingsUserShiftRoles />} />
          <Route path="review-platforms" element={<SettingsReviewPlatforms />} />
          <Route path="compensation-components" element={<SettingsCompensationComponents />} />
          <Route path="home-experience" element={<SettingsHomeExperience />} />
          <Route path="control-panel" element={<SettingsControlPanel />} />
          <Route path="google-api" element={<SettingsGoogleApi />} />
          <Route path="maintenance" element={<SettingsMaintenance />} />
        </Route>
      </ReactRoutes>
    </Suspense>
  );
};

export default Routes;
