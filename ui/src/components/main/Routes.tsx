import { Navigate, Route, Routes as ReactRoutes } from "react-router-dom";

import Home from "../../pages/Home";
import Guests from "../../pages/Guests";
import BookingsPage from "../../pages/BookingsPage";
import BookingsManifestPage from "../../pages/BookingsManifestPage";
import AvailabilityCalendar from "../../pages/AvailabilityCalendar";
import Counters from "../../pages/Counters";
import VenueNumbers from "../../pages/VenueNumbers";
import ChannelNumbers from "../../pages/ChannelNumbers";
import Pays from "../../pages/Pays";
import ReviewCounters from "../../pages/ReviewCounters";
import Reports from "../../pages/Reports";
import OpenBarControl from "../../pages/OpenBarControl";
import DerivedFieldsManager from "../../pages/DerivedFieldsManager";
import ReportDashboards from "../../pages/ReportDashboards";
import MyAccount from "../../pages/MyAccount";
import SettingsLayout from "../../pages/settings/SettingsLayout";
import SettingsLanding from "../../pages/settings/SettingsLanding";
import SettingsUsers from "../../pages/settings/SettingsUsers";
import SettingsUserTypes from "../../pages/settings/SettingsUserTypes";
import SettingsPermissions from "../../pages/settings/SettingsPermissions";
import SettingsProducts from "../../pages/settings/SettingsProducts";
import SettingsProductTypes from "../../pages/settings/SettingsProductTypes";
import SettingsProductPrices from "../../pages/settings/SettingsProductPrices";
import SettingsProductAliases from "../../pages/settings/SettingsProductAliases";
import SettingsAddons from "../../pages/settings/SettingsAddons";
import SettingsVenues from "../../pages/settings/SettingsVenues";
import SettingsProductAddons from "../../pages/settings/SettingsProductAddons";
import SettingsPaymentMethods from "../../pages/settings/SettingsPaymentMethods";
import SettingsChannelProductPrices from "../../pages/settings/SettingsChannelProductPrices";
import SettingsChannelCommissions from "../../pages/settings/SettingsChannelCommissions";
import SettingsActions from "../../pages/settings/SettingsActions";
import SettingsChannels from "../../pages/settings/SettingsChannels";
import SettingsStaffProfiles from "../../pages/settings/SettingsStaffProfiles";
import SettingsShiftRoles from "../../pages/settings/SettingsShiftRoles";
import SettingsUserShiftRoles from "../../pages/settings/SettingsUserShiftRoles";
import SettingsShiftTypes from "../../pages/settings/SettingsShiftTypes";
import SettingsSqlHelper from "../../pages/settings/SettingsSqlHelper";
import SettingsDbBackups from "../../pages/settings/SettingsDbBackups";
import SettingsHomeExperience from "../../pages/settings/SettingsHomeExperience";
import SettingsControlPanel from "../../pages/settings/SettingsControlPanel";
import SettingsMaintenance from "../../pages/settings/SettingsMaintenance";
import SettingsReviewPlatforms from "../../pages/settings/SettingsReviewPlatforms";
import SettingsCompensationComponents from "../../pages/settings/SettingsCompensationComponents";
import AssistantManagerTasks from "../../pages/AssistantManagerTasks";
import SchedulingLayout from "../../pages/scheduling/SchedulingLayout";
import AvailabilityPage from "../../pages/scheduling/AvailabilityPage";
import BuilderPage from "../../pages/scheduling/BuilderPage";
import TemplatesPage from "../../pages/scheduling/TemplatesPage";
import ScheduleOverviewPage from "../../pages/scheduling/ScheduleOverviewPage";
import MyShiftsPage from "../../pages/scheduling/MyShiftsPage";
import SwapsPage from "../../pages/scheduling/SwapsPage";
import HistoryPage from "../../pages/scheduling/HistoryPage";
import FinanceLayout from "../../pages/Finance/FinanceLayout";
import FinanceDashboard from "../../pages/Finance/FinanceDashboard";
import FinanceTransactions from "../../pages/Finance/FinanceTransactions";
import FinanceAccounts from "../../pages/Finance/FinanceAccounts";
import FinanceVendors from "../../pages/Finance/FinanceVendors";
import FinanceClients from "../../pages/Finance/FinanceClients";
import FinanceCategories from "../../pages/Finance/FinanceCategories";
import FinanceRecurring from "../../pages/Finance/FinanceRecurring";
import FinanceBudgets from "../../pages/Finance/FinanceBudgets";
import FinanceManagementRequests from "../../pages/Finance/FinanceManagementRequests";
import FinanceReports from "../../pages/Finance/FinanceReports";
import FinanceFiles from "../../pages/Finance/FinanceFiles";
import FinanceSettings from "../../pages/Finance/FinanceSettings";
import FinanceRefunds from "../../pages/Finance/FinanceRefunds";

const Routes = () => {
  return (
    <ReactRoutes>
      <Route path="/" element={<Home title="Home" />} />
      <Route path="/guests" element={<Guests title="Guests" />} />
      <Route path="/bookings" element={<BookingsPage title="Bookings" />} />
      <Route path="/bookings/manifest" element={<BookingsManifestPage title="Bookings Manifest" />} />
      <Route path="/calendar" element={<AvailabilityCalendar />} />
      <Route path="/counters" element={<Counters title="Counters" />} />
      <Route path="/venueNumbers" element={<VenueNumbers title="Venue Numbers" />} />
      <Route path="/channelNumbers" element={<ChannelNumbers title="Channel Numbers" />} />
      <Route path="/reviews" element={<ReviewCounters />} />
      <Route path="/pays" element={<Pays />} />
      <Route path="/assistant-manager-tasks" element={<AssistantManagerTasks />} />
      <Route path="/reports" element={<Reports title={"Reports"} />} />
      <Route path="/open-bar" element={<OpenBarControl title="Open Bar Control" />} />
      <Route path="/reports/open-bar" element={<Navigate to="/open-bar" replace />} />
      <Route path="/reports/derived-fields" element={<DerivedFieldsManager title="Derived fields" />} />
      <Route path="/reports/dashboards" element={<ReportDashboards title="Dashboards" />} />
      <Route path="/account" element={<MyAccount />} />
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
        <Route path="maintenance" element={<SettingsMaintenance />} />
      </Route>
    </ReactRoutes>
  );
};

export default Routes;
