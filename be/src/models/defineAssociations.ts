import Booking from './Booking.js';
import Guest from './Guest.js';
import Channel from './Channel.js';

export function defineAssociations() {
  Booking.belongsTo(Guest, { foreignKey: 'guestId' });
  Booking.belongsTo(Channel, { foreignKey: 'channelId' });
  Guest.hasMany(Booking, {
    foreignKey: 'guestId',
    as: 'guestBookings',
  });
  Channel.hasMany(Booking, {
    foreignKey: 'channelId',
    as: 'bookings',
  });
}