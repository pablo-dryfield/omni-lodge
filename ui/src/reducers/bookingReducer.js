import {
    FETCH_BOOKINGS_REQUEST,
    FETCH_BOOKINGS_SUCCESS,
    FETCH_BOOKINGS_FAILURE,
    CREATE_BOOKING_REQUEST,
    CREATE_BOOKING_SUCCESS,
    CREATE_BOOKING_FAILURE,
    UPDATE_BOOKING_REQUEST,
    UPDATE_BOOKING_SUCCESS,
    UPDATE_BOOKING_FAILURE,
    DELETE_BOOKING_REQUEST,
    DELETE_BOOKING_SUCCESS,
    DELETE_BOOKING_FAILURE,
  } from '../actions/bookingActions';
  
  const initialState = {
    loading: false,
    bookings: [],
    error: null,
  };
  
  const bookingReducer = (state = initialState, action) => {
    switch (action.type) {
      case FETCH_BOOKINGS_REQUEST:
      case CREATE_BOOKING_REQUEST:
      case UPDATE_BOOKING_REQUEST:
      case DELETE_BOOKING_REQUEST:
        return {
          ...state,
          loading: true,
          error: null,
        };
      case FETCH_BOOKINGS_SUCCESS:
        return {
          ...state,
          loading: false,
          bookings: action.payload,
          error: null,
        };
      case FETCH_BOOKINGS_FAILURE:
      case CREATE_BOOKING_FAILURE:
      case UPDATE_BOOKING_FAILURE:
      case DELETE_BOOKING_FAILURE:
        return {
          ...state,
          loading: false,
          bookings: [],
          error: action.payload,
        };
      case CREATE_BOOKING_SUCCESS:
        return {
          ...state,
          bookings: [...state.bookings, action.payload],
        };
      case UPDATE_BOOKING_SUCCESS:
        return {
          ...state,
          bookings: state.bookings.map((booking) =>
            booking.id === action.payload.id ? action.payload : booking
          ),
        };
      case DELETE_BOOKING_SUCCESS:
        return {
          ...state,
          bookings: state.bookings.filter((booking) => booking.id !== action.payload),
        };
      default:
        return state;
    }
  };
  
  export default bookingReducer;
  