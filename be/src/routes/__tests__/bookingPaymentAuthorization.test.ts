jest.mock('../../controllers/pendingExternalRefundController.js', () => ({ getPendingExternalRefunds: (_req: any, res: any) => res.status(200).json({ data: [] }) }));
import express from 'express';
import request from 'supertest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../middleware/authMiddleware.js', () => ({ __esModule: true, default: (req: AuthenticatedRequest, res: Response, next: () => void) => {
  if (!req.header('x-test-role')) return res.status(401).json({ message: 'Unauthorized' });
  req.authContext = { id: 8, roleSlug: req.header('x-test-role')!, userTypeId: 7 }; next();
} }));
jest.mock('../../services/productScopeService.js', () => ({ requireBookingProductScope: (req: AuthenticatedRequest, res: Response, next: () => void) => {
  if (req.header('x-outside-scope')) return res.status(403).json({ message: 'Outside product scope' }); next();
} }));
jest.mock('../../controllers/bookingController.js', () => new Proxy({ __esModule: true }, { get: (_target, key) => key === '__esModule' ? true : (_req: unknown, res: Response) => res.sendStatus(204) }));
jest.mock('../../controllers/localBookingActionController.js', () => new Proxy({ __esModule: true }, { get: (_target, key) => key === '__esModule' ? true : (_req: unknown, res: Response) => res.sendStatus(204) }));
jest.mock('../../controllers/bookingSanityController.js', () => new Proxy({ __esModule: true }, { get: (_target, key) => key === '__esModule' ? true : (_req: unknown, res: Response) => res.sendStatus(204) }));
jest.mock('../../controllers/bookingSummaryController.js', () => ({ listBookingsWithSummary: (_req: unknown, res: Response) => res.sendStatus(204) }));
jest.mock('../../services/bookings/bookingPaymentService.js', () => ({ getBookingPaymentDetails: jest.fn(), getBookingPaymentEvents: jest.fn(), paymentReadError: () => 'Payment unavailable' }));

import router from '../bookingRoutes';
import { getBookingPaymentDetails, getBookingPaymentEvents } from '../../services/bookings/bookingPaymentService';
import HttpError from '../../errors/HttpError';
const app = express(); app.use('/bookings', router);
beforeEach(() => { jest.resetAllMocks(); (getBookingPaymentDetails as jest.Mock).mockResolvedValue({ bookingId: 42 }); (getBookingPaymentEvents as jest.Mock).mockResolvedValue({ events: [] }); });

it.each(['/42/payments', '/42/payments/events'])('enforces authentication and product scope for %s before Stripe access', async path => {
  expect((await request(app).get(`/bookings${path}`)).status).toBe(401);
  expect((await request(app).get(`/bookings${path}`).set('x-test-role', 'food-tour-owner').set('x-outside-scope', 'yes')).status).toBe(403);
  expect(getBookingPaymentDetails).not.toHaveBeenCalled(); expect(getBookingPaymentEvents).not.toHaveBeenCalled();
});
it('prevents caching and resolves only the URL booking ID despite arbitrary payment query parameters', async () => {
  const result = await request(app).get('/bookings/42/payments?paymentId=pi_Unrelated&merchant=other').set('x-test-role', 'food-tour-manager');
  expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('private, no-store');
  expect(getBookingPaymentDetails).toHaveBeenCalledWith(42);
});
it.each(['0', '-1', 'NaN', '1.2', '9007199254740992'])('rejects malformed booking IDs: %s', async id => {
  expect((await request(app).get(`/bookings/${id}/payments`).set('x-test-role', 'manager')).status).toBe(400);
  expect(getBookingPaymentDetails).not.toHaveBeenCalled();
});
it('validates cursor shapes and propagates explicit service errors', async () => {
  const headers = { 'x-test-role': 'manager' };
  expect((await request(app).get('/bookings/42/payments/events?cursor[]=one').set(headers)).status).toBe(400);
  expect((await request(app).get('/bookings/42/payments/events').query({ cursor: 'x'.repeat(301) }).set(headers)).status).toBe(400);
  expect(getBookingPaymentEvents).not.toHaveBeenCalled();
  (getBookingPaymentEvents as jest.Mock).mockRejectedValueOnce(new HttpError(400, 'Cursor expired'));
  expect((await request(app).get('/bookings/42/payments/events?cursor=old').set(headers)).body.message).toBe('Cursor expired');
});
it('never returns raw provider or database error messages', async () => {
  (getBookingPaymentDetails as jest.Mock).mockRejectedValue(new Error('PRIVATE-DATABASE-SECRET'));
  const result = await request(app).get('/bookings/42/payments').set('x-test-role', 'manager');
  expect(result.status).toBe(502); expect(result.text).not.toContain('PRIVATE');
});
