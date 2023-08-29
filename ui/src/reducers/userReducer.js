import {
    FETCH_USERS_REQUEST,
    FETCH_USERS_SUCCESS,
    FETCH_USERS_FAILURE,
    CREATE_USER_REQUEST,
    CREATE_USER_SUCCESS,
    CREATE_USER_FAILURE,
    UPDATE_USER_REQUEST,
    UPDATE_USER_SUCCESS,
    UPDATE_USER_FAILURE,
    DELETE_USER_REQUEST,
    DELETE_USER_SUCCESS,
    DELETE_USER_FAILURE,
  } from '../actions/userActions';
  
  const initialState = {
    loading: false,
    users: [],
    error: null,
  };
  
  const userReducer = (state = initialState, action) => {
    switch (action.type) {
      case FETCH_USERS_REQUEST:
      case CREATE_USER_REQUEST:
      case UPDATE_USER_REQUEST:
      case DELETE_USER_REQUEST:
        return {
          ...state,
          loading: true,
          error: null,
        };
      case FETCH_USERS_SUCCESS:
        return {
          ...state,
          loading: false,
          users: action.payload,
          error: null,
        };
      case FETCH_USERS_FAILURE:
      case CREATE_USER_FAILURE:
      case UPDATE_USER_FAILURE:
      case DELETE_USER_FAILURE:
        return {
          ...state,
          loading: false,
          users: [],
          error: action.payload,
        };
      case CREATE_USER_SUCCESS:
        return {
          ...state,
          users: [...state.users, action.payload],
        };
      case UPDATE_USER_SUCCESS:
        return {
          ...state,
          users: state.users.map((user) =>
            user.id === action.payload.id ? action.payload : user
          ),
        };
      case DELETE_USER_SUCCESS:
        return {
          ...state,
          users: state.users.filter((user) => user.id !== action.payload),
        };
      default:
        return state;
    }
  };
  
  export default userReducer;
  