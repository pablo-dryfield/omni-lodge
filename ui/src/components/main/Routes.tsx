import { Route, Routes as ReactRoutes } from "react-router-dom";

import Home from "../../pages/Home";
import Guests from "../../pages/Guests";
import BookingsPage from "../../pages/BookingsPage";
import BookingsManifestPage from "../../pages/BookingsManifestPage";
import AvailabilityCalendar from "../../pages/AvailabilityCalendar";
import Channels from "../../pages/Channels";
import Counters from "../../pages/Counters";
import Products from "../../pages/Products";
import ProductTypes from "../../pages/ProductTypes";
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

const Routes = () => {
  return (
    <ReactRoutes>
      <Route path="/" element={<Home title="Home" />} />
      <Route path="/guests" element={<Guests title="Guests" />} />
      <Route path="/bookings" element={<BookingsPage title="Bookings" />} />
      <Route path="/bookings/manifest" element={<BookingsManifestPage title="Bookings Manifest" />} />
      <Route path="/calendar" element={<AvailabilityCalendar />} />
      <Route path="/channels" element={<Channels title="Channels" />} />
      <Route path="/counters" element={<Counters title="Counters" />} />
      <Route path="/products" element={<Products title="Products" />} />
      <Route path="/productTypes" element={<ProductTypes title="Product Types" />} />
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
      </Route>
    </ReactRoutes>
  );
};

export default Routes;

