import {
    FETCH_CHANNELS_REQUEST,
    FETCH_CHANNELS_SUCCESS,
    FETCH_CHANNELS_FAILURE,
    CREATE_CHANNEL_REQUEST,
    CREATE_CHANNEL_SUCCESS,
    CREATE_CHANNEL_FAILURE,
    UPDATE_CHANNEL_REQUEST,
    UPDATE_CHANNEL_SUCCESS,
    UPDATE_CHANNEL_FAILURE,
    DELETE_CHANNEL_REQUEST,
    DELETE_CHANNEL_SUCCESS,
    DELETE_CHANNEL_FAILURE,
  } from '../actions/channelActions';
  
  const initialState = {
    loading: false,
    channels: [],
    error: null,
  };
  
  const channelReducer = (state = initialState, action) => {
    switch (action.type) {
      case FETCH_CHANNELS_REQUEST:
      case CREATE_CHANNEL_REQUEST:
      case UPDATE_CHANNEL_REQUEST:
      case DELETE_CHANNEL_REQUEST:
        return {
          ...state,
          loading: true,
          error: null,
        };
      case FETCH_CHANNELS_SUCCESS:
        return {
          ...state,
          loading: false,
          channels: action.payload,
          error: null,
        };
      case FETCH_CHANNELS_FAILURE:
      case CREATE_CHANNEL_FAILURE:
      case UPDATE_CHANNEL_FAILURE:
      case DELETE_CHANNEL_FAILURE:
        return {
          ...state,
          loading: false,
          channels: [],
          error: action.payload,
        };
      case CREATE_CHANNEL_SUCCESS:
        return {
          ...state,
          channels: [...state.channels, action.payload],
        };
      case UPDATE_CHANNEL_SUCCESS:
        return {
          ...state,
          channels: state.channels.map((channel) =>
            channel.id === action.payload.id ? action.payload : channel
          ),
        };
      case DELETE_CHANNEL_SUCCESS:
        return {
          ...state,
          channels: state.channels.filter((channel) => channel.id !== action.payload),
        };
      default:
        return state;
    }
  };
  
  export default channelReducer;
  