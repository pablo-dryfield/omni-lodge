// Action types for left sidebar options
export const SHOW_GUESTS = 'SHOW_GUESTS';
export const SHOW_BOOKINGS = 'SHOW_BOOKINGS';

// Action creators for left sidebar options
export const showGuests = () => ({
  type: SHOW_GUESTS,
});

export const showBookings = () => ({
  type: SHOW_BOOKINGS,
});
