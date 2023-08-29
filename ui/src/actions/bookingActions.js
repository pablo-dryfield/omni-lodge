import axiosInstance from './../utils/axiosInstance';

// Action types
export const FETCH_BOOKINGS_REQUEST = 'FETCH_BOOKINGS_REQUEST';
export const FETCH_BOOKINGS_SUCCESS = 'FETCH_BOOKINGS_SUCCESS';
export const FETCH_BOOKINGS_FAILURE = 'FETCH_BOOKINGS_FAILURE';
export const CREATE_BOOKING_REQUEST = 'CREATE_BOOKING_REQUEST';
export const CREATE_BOOKING_SUCCESS = 'CREATE_BOOKING_SUCCESS';
export const CREATE_BOOKING_FAILURE = 'CREATE_BOOKING_FAILURE';
export const UPDATE_BOOKING_REQUEST = 'UPDATE_BOOKING_REQUEST';
export const UPDATE_BOOKING_SUCCESS = 'UPDATE_BOOKING_SUCCESS';
export const UPDATE_BOOKING_FAILURE = 'UPDATE_BOOKING_FAILURE';
export const DELETE_BOOKING_REQUEST = 'DELETE_BOOKING_REQUEST';
export const DELETE_BOOKING_SUCCESS = 'DELETE_BOOKING_SUCCESS';
export const DELETE_BOOKING_FAILURE = 'DELETE_BOOKING_FAILURE';

// Fetch bookings
export const fetchBookings = () => async (dispatch) => {
  dispatch({ type: FETCH_BOOKINGS_REQUEST });

  try {
    const response = await axiosInstance.get('/api/bookings');
    dispatch({ type: FETCH_BOOKINGS_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: FETCH_BOOKINGS_FAILURE, payload: error.message });
  }
};

// Create booking
export const createBooking = (bookingData) => async (dispatch) => {
  dispatch({ type: CREATE_BOOKING_REQUEST });

  try {
    const response = await axiosInstance.post('/api/bookings', bookingData);
    dispatch({ type: CREATE_BOOKING_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: CREATE_BOOKING_FAILURE, payload: error.message });
  }
};

// Update booking
export const updateBooking = (bookingId, bookingData) => async (dispatch) => {
  dispatch({ type: UPDATE_BOOKING_REQUEST });

  try {
    const response = await axiosInstance.put(`/api/bookings/${bookingId}`, bookingData);
    dispatch({ type: UPDATE_BOOKING_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: UPDATE_BOOKING_FAILURE, payload: error.message });
  }
};

// Delete booking
export const deleteBooking = (bookingId) => async (dispatch) => {
  dispatch({ type: DELETE_BOOKING_REQUEST });

  try {
    await axiosInstance.delete(`/api/bookings/${bookingId}`);
    dispatch({ type: DELETE_BOOKING_SUCCESS, payload: bookingId });
  } catch (error) {
    dispatch({ type: DELETE_BOOKING_FAILURE, payload: error.message });
  }
};
