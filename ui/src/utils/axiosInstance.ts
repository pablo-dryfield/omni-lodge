import axios from 'axios';
import prodConfig from '../config/prodConfig';
import devConfig from '../config/devConfig';

const config = process.env.NODE_ENV === 'production' ? prodConfig : devConfig;

const instance = axios.create({
  baseURL: config.baseURL, // Replace with the actual URL of your server
  withCredentials: true,
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
