import { Route, Routes as ReactRoutes } from 'react-router-dom';

import Home from '../../pages/Home';
import Guests from '../../pages/Guests';
import Bookings from '../../pages/Bookings';
import AvailabilityCalendar from '../../pages/AvailabilityCalendar';
import Channels from '../../pages/Channels';
import Users from '../../pages/Users';
import Counters from '../../pages/Counters';
import Products from '../../pages/Products';
import ProductTypes from '../../pages/ProductTypes';
import UserTypes from '../../pages/UserTypes';

const Routes = () => {
  return (
    <ReactRoutes>
      <Route path="/" element={<Home title="Home"/>} />
      <Route path="/guests" element={<Guests title="Guests"/>} />
      <Route path="/bookings" element={<Bookings title="Bookings"/>} />
      <Route path="/calendar" element={<AvailabilityCalendar />} />
      <Route path="/channels" element={<Channels title="Channels" />} />
      <Route path="/users" element={<Users title="Users" />} />
      <Route path="/counters" element={<Counters title="Counters" />} />
      <Route path="/products" element={<Products title="Products" />} />
      <Route path="/productTypes" element={<ProductTypes title="Product Types" />} />
      <Route path="/userTypes" element={<UserTypes title="User Types" />} />
    </ReactRoutes>
  );
};

export default Routes;
