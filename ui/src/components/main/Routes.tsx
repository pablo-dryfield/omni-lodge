import { Route, Routes as ReactRoutes } from 'react-router-dom';

import Home from '../../pages/Home';
import Guests from '../../pages/Guests';
import Bookings from '../../pages/Bookings';
import AvailabilityCalendar from '../../pages/AvailabilityCalendar';
import Channels from '../../pages/Channels';
import Users from '../../pages/Users';

const Routes = () => {
  return (
    <ReactRoutes>
      <Route path="/" element={<Home />} />
      <Route path="/guests" element={<Guests />} />
      <Route path="/bookings" element={<Bookings />} />
      <Route path="/calendar" element={<AvailabilityCalendar />} />
      <Route path="/channels" element={<Channels />} />
      <Route path="/users" element={<Users />} />
    </ReactRoutes>
  );
};

export default Routes;
