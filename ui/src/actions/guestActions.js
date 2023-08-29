import axiosInstance from './../utils/axiosInstance';

export const FETCH_GUESTS_REQUEST = 'FETCH_GUESTS_REQUEST';
export const FETCH_GUESTS_SUCCESS = 'FETCH_GUESTS_SUCCESS';
export const FETCH_GUESTS_FAILURE = 'FETCH_GUESTS_FAILURE';
export const CREATE_GUEST_REQUEST = 'CREATE_GUEST_REQUEST';
export const CREATE_GUEST_SUCCESS = 'CREATE_GUEST_SUCCESS';
export const CREATE_GUEST_FAILURE = 'CREATE_GUEST_FAILURE';
export const UPDATE_GUEST_REQUEST = 'UPDATE_GUEST_REQUEST';
export const UPDATE_GUEST_SUCCESS = 'UPDATE_GUEST_SUCCESS';
export const UPDATE_GUEST_FAILURE = 'UPDATE_GUEST_FAILURE';
export const DELETE_GUEST_REQUEST = 'DELETE_GUEST_REQUEST';
export const DELETE_GUEST_SUCCESS = 'DELETE_GUEST_SUCCESS';
export const DELETE_GUEST_FAILURE = 'DELETE_GUEST_FAILURE';

// Fetch guests
export const fetchGuests = () => async (dispatch) => {
  dispatch({ type: FETCH_GUESTS_REQUEST });

  try {
    const response = await axiosInstance.get('/api/guests');
    dispatch({ type: FETCH_GUESTS_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: FETCH_GUESTS_FAILURE, payload: error.message });
  }
};

// Create guest
export const createGuest = (guestData) => async (dispatch) => {
  dispatch({ type: CREATE_GUEST_REQUEST });

  try {
    const response = await axiosInstance.post('/api/guests', guestData);
    dispatch({ type: CREATE_GUEST_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: CREATE_GUEST_FAILURE, payload: error.message });
  }
};

// Update guest
export const updateGuest = (guestId, guestData) => async (dispatch) => {
  dispatch({ type: UPDATE_GUEST_REQUEST });

  try {
    const response = await axiosInstance.put(`/api/guests/${guestId}`, guestData);
    dispatch({ type: UPDATE_GUEST_SUCCESS, payload: response.data });
  } catch (error) {
    dispatch({ type: UPDATE_GUEST_FAILURE, payload: error.message });
  }
};

// Delete guest
export const deleteGuest = (guestId) => async (dispatch) => {
  dispatch({ type: DELETE_GUEST_REQUEST });

  try {
    await axiosInstance.delete(`/api/guests/${guestId}`);
    dispatch({ type: DELETE_GUEST_SUCCESS, payload: guestId });
  } catch (error) {
    dispatch({ type: DELETE_GUEST_FAILURE, payload: error.message });
  }
};
