import axios from 'axios';
import prodConfig from '../config/prodConfig';
import devConfig from '../config/devConfig';

const config = process.env.NODE_ENV === 'production' ? prodConfig : devConfig;

const instance = axios.create({
  baseURL: config.baseURL, // Replace with the actual URL of your server
  withCredentials: true,
});

const notifyServerDown = (details: { status?: number; isNetworkError?: boolean; message?: string }) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent("omni-server-down", { detail: details }));
  } catch {
    // Ignore event dispatch failures in older environments.
  }
};

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

const isRequestCanceled = (error: unknown): boolean => {
  if (!error) {
    return false;
  }
  if (axios.isCancel(error)) {
    return true;
  }
  const candidate = error as { code?: string; name?: string; message?: string };
  return (
    candidate.code === "ERR_CANCELED" ||
    candidate.name === "CanceledError" ||
    candidate.message === "canceled"
  );
};

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isRequestCanceled(error)) {
      return Promise.reject(error);
    }
    const status = error?.response?.status as number | undefined;
    const isNetworkError = !error?.response;
    const isServerError = typeof status === "number" && status >= 500;
    if (isNetworkError || isServerError) {
      notifyServerDown({ status, isNetworkError, message: error?.message });
    }
    return Promise.reject(error);
  }
);

export default instance;
