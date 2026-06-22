import type { Request, Response } from 'express';
import HttpError from '../errors/HttpError.js';
import {
  fetchGetYourGuideBooking,
  getGetYourGuideAvailability,
  ingestGetYourGuidePayload,
} from '../services/getYourGuideIntegrationService.js';

type BodyParams = Record<string, unknown>;

const normalizeParam = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const respondWithError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details ?? null });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  res.status(500).json({ error: message });
};

const resolveRequestedPlatformBookingId = (req: Request): string | null => {
  const body = req.body as BodyParams | undefined;
  return normalizeParam(req.params.platformBookingId) ?? normalizeParam(body?.platformBookingId) ?? normalizeParam(body?.bookingReference);
};

const resolveRequestedDate = (req: Request): string | null => {
  const body = req.body as BodyParams | undefined;
  const query = req.query as BodyParams;
  return (
    normalizeParam(query.date) ??
    normalizeParam(body?.date) ??
    normalizeParam(body?.experienceDate) ??
    normalizeParam(query.experienceDate)
  );
};

const ingestWithOperation = async (req: Request, res: Response, operation: 'reserve' | 'cancel' | 'upsert'): Promise<void> => {
  try {
    const requestedPlatformBookingId = resolveRequestedPlatformBookingId(req);
    const result = await ingestGetYourGuidePayload(req.body, {
      operation,
      requestedPlatformBookingId,
    });

    res.status(200).json({
      ok: true,
      platform: result.booking.platform,
      platformBookingId: result.booking.platformBookingId,
      bookingId: result.booking.id,
      eventId: result.bookingEvent.id,
      eventType: result.eventType,
      status: result.status,
      createdBooking: result.createdBooking,
    });
  } catch (error) {
    respondWithError(res, error);
  }
};

export const healthCheck = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ ok: true, service: 'getyourguide' });
};

export const ingestReservation = async (req: Request, res: Response): Promise<void> => {
  await ingestWithOperation(req, res, 'reserve');
};

export const ingestCancellation = async (req: Request, res: Response): Promise<void> => {
  await ingestWithOperation(req, res, 'cancel');
};

export const ingestBooking = async (req: Request, res: Response): Promise<void> => {
  await ingestWithOperation(req, res, 'upsert');
};

export const getBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const requestedPlatformBookingId = resolveRequestedPlatformBookingId(req);
    if (!requestedPlatformBookingId) {
      throw new HttpError(400, 'Missing GetYourGuide booking reference');
    }

    const booking = await fetchGetYourGuideBooking(requestedPlatformBookingId);
    if (!booking) {
      throw new HttpError(404, 'GetYourGuide booking not found');
    }

    res.status(200).json({
      ok: true,
      booking,
    });
  } catch (error) {
    respondWithError(res, error);
  }
};

export const getAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const requestedDate = resolveRequestedDate(req);
    if (!requestedDate) {
      throw new HttpError(400, 'Missing date query parameter');
    }

    const requestedBody = (req.body as BodyParams | undefined) ?? {};
    const requestedProduct = {
      productId: requestedBody.productId ?? (req.params as BodyParams).productId ?? (req.query as BodyParams).productId ?? null,
      productName: requestedBody.productName ?? (req.query as BodyParams).productName ?? null,
    };
    const result = await getGetYourGuideAvailability(requestedDate, requestedProduct);
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    respondWithError(res, error);
  }
};
