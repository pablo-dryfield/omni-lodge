import axios from 'axios';

const instance = axios.create();

// Add a request interceptor
instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken'); // Retrieve the JWT token from storage
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default instance;
