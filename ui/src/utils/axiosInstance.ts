import axios from 'axios';
import prodConfig from '../config/prodConfig';
import devConfig from '../config/devConfig';
import {
  dispatchServerAvailabilityCandidate,
  type ServerAvailabilityCandidateDetail,
} from './serverAvailability';

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

const resolveRequestUrl = (baseURL: unknown, url: unknown): string | undefined => {
  if (typeof url !== "string" || !url) {
    return typeof baseURL === "string" && baseURL ? baseURL : undefined;
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url) || typeof baseURL !== "string" || !baseURL) {
    return url;
  }
  return `${baseURL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
};

type AvailabilityCandidateError = {
  response?: { status?: unknown };
  config?: { method?: unknown; baseURL?: unknown; url?: unknown };
  message?: unknown;
  code?: unknown;
};

const getCandidateDetail = (error: unknown): ServerAvailabilityCandidateDetail => {
  const candidate = (
    typeof error === "object" && error !== null ? error : {}
  ) as AvailabilityCandidateError;
  const method = typeof candidate.config?.method === "string"
    ? candidate.config.method.toUpperCase()
    : undefined;

  return {
    status: typeof candidate.response?.status === "number" ? candidate.response.status : undefined,
    isNetworkError: !candidate.response,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    method,
    url: resolveRequestUrl(candidate.config?.baseURL, candidate.config?.url),
    visibilityState: typeof document === "undefined" ? undefined : document.visibilityState,
    occurredAt: Date.now(),
  };
};

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isRequestCanceled(error)) {
      return Promise.reject(error);
    }
    const detail = getCandidateDetail(error);
    const { status, isNetworkError } = detail;
    const isServerError = typeof status === "number" && status >= 500;
    if (isNetworkError || isServerError) {
      dispatchServerAvailabilityCandidate(detail);
    }
    return Promise.reject(error);
  }
);

export default instance;
