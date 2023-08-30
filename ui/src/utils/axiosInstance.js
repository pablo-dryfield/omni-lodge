import axios from 'axios';
import config from '../config/devConfig';

const instance = axios.create({
  baseURL: config.baseURL, // Replace with the actual URL of your server
});

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
