import express from 'express';
import request from 'supertest';
import healthRoutes from '../healthRoutes';

const buildApp = () => {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
};

describe('health routes', () => {
  it('reports process readiness without authentication or caching', async () => {
    const response = await request(buildApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      status: 'ok',
      ready: true,
      uptimeSeconds: expect.any(Number),
    });
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
