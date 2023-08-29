import {
  FETCH_GUESTS_REQUEST,
  FETCH_GUESTS_SUCCESS,
  FETCH_GUESTS_FAILURE,
  CREATE_GUEST_REQUEST,
  CREATE_GUEST_SUCCESS,
  CREATE_GUEST_FAILURE,
  UPDATE_GUEST_REQUEST,
  UPDATE_GUEST_SUCCESS,
  UPDATE_GUEST_FAILURE,
  DELETE_GUEST_REQUEST,
  DELETE_GUEST_SUCCESS,
  DELETE_GUEST_FAILURE,
} from '../actions/guestActions';

const initialState = {
  loading: false,
  guests: [],
  error: null,
};

const guestReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_GUESTS_REQUEST:
    case CREATE_GUEST_REQUEST:
    case UPDATE_GUEST_REQUEST:
    case DELETE_GUEST_REQUEST:
      return {
        ...state,
        loading: true,
        error: null,
      };
    case FETCH_GUESTS_SUCCESS:
      return {
        ...state,
        loading: false,
        guests: action.payload,
        error: null,
      };
    case FETCH_GUESTS_FAILURE:
    case CREATE_GUEST_FAILURE:
    case UPDATE_GUEST_FAILURE:
    case DELETE_GUEST_FAILURE:
      return {
        ...state,
        loading: false,
        guests: [],
        error: action.payload,
      };
    case CREATE_GUEST_SUCCESS:
      return {
        ...state,
        guests: [...state.guests, action.payload],
      };
    case UPDATE_GUEST_SUCCESS:
      return {
        ...state,
        guests: state.guests.map((guest) =>
          guest.id === action.payload.id ? action.payload : guest
        ),
      };
    case DELETE_GUEST_SUCCESS:
      return {
        ...state,
        guests: state.guests.filter((guest) => guest.id !== action.payload),
      };
    default:
      return state;
  }
};

export default guestReducer;
