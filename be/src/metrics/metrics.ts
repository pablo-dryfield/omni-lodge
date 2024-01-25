import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

// Create a new Registry for the Prometheus metrics
const register = new Registry();

// Collect default metrics (e.g., CPU, memory, event loop, etc.)
collectDefaultMetrics({ register });

// Define your custom metrics
export const requestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register], // Note: the property is 'register' in prom-client v13+
});

export const responseTimeHistogram = new Histogram({
  name: 'http_response_time_seconds',
  help: 'HTTP response time in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.1, 0.5, 1, 5], // Define your desired buckets
  registers: [register], // Note: the property is 'register' in prom-client v13+
});

// Export the Prometheus
export default register;