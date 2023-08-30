import axiosInstance from './../utils/axiosInstance';

// Define action types
export const FETCH_USERS_REQUEST = 'FETCH_USERS_REQUEST';
export const FETCH_USERS_SUCCESS = 'FETCH_USERS_SUCCESS';
export const FETCH_USERS_FAILURE = 'FETCH_USERS_FAILURE';
export const CREATE_USER_REQUEST = 'CREATE_USER_REQUEST';
export const CREATE_USER_SUCCESS = 'CREATE_USER_SUCCESS';
export const CREATE_USER_FAILURE = 'CREATE_USER_FAILURE';
export const UPDATE_USER_REQUEST = 'UPDATE_USER_REQUEST';
export const UPDATE_USER_SUCCESS = 'UPDATE_USER_SUCCESS';
export const UPDATE_USER_FAILURE = 'UPDATE_USER_FAILURE';
export const DELETE_USER_REQUEST = 'DELETE_USER_REQUEST';
export const DELETE_USER_SUCCESS = 'DELETE_USER_SUCCESS';
export const DELETE_USER_FAILURE = 'DELETE_USER_FAILURE';

// Fetch users
export const fetchUsers = () => async (dispatch) => {
  dispatch({ type: FETCH_USERS_REQUEST });

  try {
    const response = await axiosInstance.get('/api/users');
    dispatch({ type: FETCH_USERS_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: FETCH_USERS_FAILURE, payload: error.message });
  }
};

// Create user
export const createUser = (userData) => async (dispatch) => {
  dispatch({ type: CREATE_USER_REQUEST });

  try {
    const response = await axiosInstance.post('/api/users/register', userData);
    dispatch({ type: CREATE_USER_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: CREATE_USER_FAILURE, payload: error.message });
  }
};

// Update user
export const updateUser = (userId, userData) => async (dispatch) => {
  dispatch({ type: UPDATE_USER_REQUEST });

  try {
    const response = await axiosInstance.put(`/api/users/${userId}`, userData);
    dispatch({ type: UPDATE_USER_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: UPDATE_USER_FAILURE, payload: error.message });
  }
};

// Delete user
export const deleteUser = (userId) => async (dispatch) => {
  dispatch({ type: DELETE_USER_REQUEST });

  try {
    await axiosInstance.delete(`/api/users/${userId}`);
    dispatch({ type: DELETE_USER_SUCCESS, payload: userId });
  } catch (error) {
    dispatch({ type: DELETE_USER_FAILURE, payload: error.message });
  }
};
