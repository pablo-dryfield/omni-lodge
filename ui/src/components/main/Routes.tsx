import { Route, Routes as ReactRoutes } from "react-router-dom";

import Home from "../../pages/Home";
import Guests from "../../pages/Guests";
import BookingsPage from "../../pages/BookingsPage";
import BookingsManifestPage from "../../pages/BookingsManifestPage";
import AvailabilityCalendar from "../../pages/AvailabilityCalendar";
import Counters from "../../pages/Counters";
import VenueNumbers from "../../pages/VenueNumbers";
import Pays from "../../pages/Pays";
import Reports from "../../pages/Reports";
import SettingsLayout from "../../pages/settings/SettingsLayout";
import SettingsLanding from "../../pages/settings/SettingsLanding";
import SettingsUsers from "../../pages/settings/SettingsUsers";
import SettingsUserTypes from "../../pages/settings/SettingsUserTypes";
import SettingsPages from "../../pages/settings/SettingsPages";
import SettingsModules from "../../pages/settings/SettingsModules";
import SettingsPermissions from "../../pages/settings/SettingsPermissions";
import SettingsPagePermissions from "../../pages/settings/SettingsPagePermissions";
import SettingsModulePermissions from "../../pages/settings/SettingsModulePermissions";
import SettingsProducts from "../../pages/settings/SettingsProducts";
import SettingsProductTypes from "../../pages/settings/SettingsProductTypes";
import SettingsProductPrices from "../../pages/settings/SettingsProductPrices";
import SettingsAddons from "../../pages/settings/SettingsAddons";
import SettingsVenues from "../../pages/settings/SettingsVenues";
import SettingsProductAddons from "../../pages/settings/SettingsProductAddons";
import SettingsPaymentMethods from "../../pages/settings/SettingsPaymentMethods";
import SettingsChannelProductPrices from "../../pages/settings/SettingsChannelProductPrices";
import SettingsChannelCommissions from "../../pages/settings/SettingsChannelCommissions";
import SettingsActions from "../../pages/settings/SettingsActions";
import SettingsChannels from "../../pages/settings/SettingsChannels";

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
      <Route path="/pays" element={<Pays />} />
      <Route path="/reports" element={<Reports title={"Reports"} />} />

      <Route path="/settings" element={<SettingsLayout />}>
        <Route index element={<SettingsLanding />} />
        <Route path="users" element={<SettingsUsers />} />
        <Route path="user-types" element={<SettingsUserTypes />} />
        <Route path="pages" element={<SettingsPages />} />
        <Route path="modules" element={<SettingsModules />} />
        <Route path="permissions" element={<SettingsPermissions />} />
        <Route path="permissions/pages" element={<SettingsPagePermissions />} />
        <Route path="permissions/modules" element={<SettingsModulePermissions />} />
        <Route path="products" element={<SettingsProducts />} />
        <Route path="product-prices" element={<SettingsProductPrices />} />
        <Route path="product-types" element={<SettingsProductTypes />} />
        <Route path="addons" element={<SettingsAddons />} />
        <Route path="venues" element={<SettingsVenues />} />
        <Route path="product-addons" element={<SettingsProductAddons />} />
        <Route path="payment-methods" element={<SettingsPaymentMethods />} />
        <Route path="channel-product-prices" element={<SettingsChannelProductPrices />} />
        <Route path="channel-commissions" element={<SettingsChannelCommissions />} />
        <Route path="actions" element={<SettingsActions />} />
        <Route path="channels" element={<SettingsChannels />} />
      </Route>
    </ReactRoutes>
  );
};

export default Routes;

