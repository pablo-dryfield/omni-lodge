import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import { getBookingPaymentDetails, getBookingPaymentEvents, paymentReadError } from '../services/bookings/bookingPaymentService.js';

const bookingId = (req: AuthenticatedRequest): number => {
  const value = Number(req.params.bookingId);
  if (!Number.isSafeInteger(value) || value <= 0) throw new HttpError(400, 'A valid booking ID is required.');
  return value;
};
export async function bookingPaymentDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  try { res.status(200).json(await getBookingPaymentDetails(bookingId(req))); }
  catch (error) { res.status(error instanceof HttpError ? error.status : 502).json({ message: error instanceof HttpError ? error.message : paymentReadError(error) }); }
}
export async function bookingPaymentEvents(req: AuthenticatedRequest, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const cursor = req.query.cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 300)) throw new HttpError(400, 'Invalid event cursor.');
    res.status(200).json(await getBookingPaymentEvents(bookingId(req), cursor));
  } catch (error) { res.status(error instanceof HttpError ? error.status : 502).json({ message: error instanceof HttpError ? error.message : paymentReadError(error) }); }
}
