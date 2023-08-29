import axiosInstance from './../utils/axiosInstance';

export const FETCH_CHANNELS_REQUEST = 'FETCH_CHANNELS_REQUEST';
export const FETCH_CHANNELS_SUCCESS = 'FETCH_CHANNELS_SUCCESS';
export const FETCH_CHANNELS_FAILURE = 'FETCH_CHANNELS_FAILURE';
export const CREATE_CHANNEL_REQUEST = 'CREATE_CHANNEL_REQUEST';
export const CREATE_CHANNEL_SUCCESS = 'CREATE_CHANNEL_SUCCESS';
export const CREATE_CHANNEL_FAILURE = 'CREATE_CHANNEL_FAILURE';
export const UPDATE_CHANNEL_REQUEST = 'UPDATE_CHANNEL_REQUEST';
export const UPDATE_CHANNEL_SUCCESS = 'UPDATE_CHANNEL_SUCCESS';
export const UPDATE_CHANNEL_FAILURE = 'UPDATE_CHANNEL_FAILURE';
export const DELETE_CHANNEL_REQUEST = 'DELETE_CHANNEL_REQUEST';
export const DELETE_CHANNEL_SUCCESS = 'DELETE_CHANNEL_SUCCESS';
export const DELETE_CHANNEL_FAILURE = 'DELETE_CHANNEL_FAILURE';

// Fetch channels
export const fetchChannels = () => async (dispatch) => {
  dispatch({ type: FETCH_CHANNELS_REQUEST });

  try {
    const response = await axiosInstance.get('/api/channels');
    dispatch({ type: FETCH_CHANNELS_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: FETCH_CHANNELS_FAILURE, payload: error.message });
  }
};

// Create channel
export const createChannel = (channelData) => async (dispatch) => {
  dispatch({ type: CREATE_CHANNEL_REQUEST });

  try {
    const response = await axiosInstance.post('/api/channels', channelData);
    dispatch({ type: CREATE_CHANNEL_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: CREATE_CHANNEL_FAILURE, payload: error.message });
  }
};

// Update channel
export const updateChannel = (channelId, channelData) => async (dispatch) => {
  dispatch({ type: UPDATE_CHANNEL_REQUEST });

  try {
    const response = await axiosInstance.put(`/api/channels/${channelId}`, channelData);
    dispatch({ type: UPDATE_CHANNEL_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: UPDATE_CHANNEL_FAILURE, payload: error.message });
  }
};

// Delete channel
export const deleteChannel = (channelId) => async (dispatch) => {
  dispatch({ type: DELETE_CHANNEL_REQUEST });

  try {
    await axiosInstance.delete(`/api/channels/${channelId}`);
    dispatch({ type: DELETE_CHANNEL_SUCCESS, payload: channelId });
  } catch (error) {
    dispatch({ type: DELETE_CHANNEL_FAILURE, payload: error.message });
  }
};
