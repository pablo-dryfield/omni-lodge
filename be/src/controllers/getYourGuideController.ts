import type { Request, Response } from 'express';
import HttpError from '../errors/HttpError.js';
import {
  fetchGetYourGuideBooking,
  getGetYourGuideAvailabilities,
  ingestGetYourGuidePayload,
} from '../services/getYourGuideIntegrationService.js';

type BodyParams = Record<string, unknown>;
type GygBookingTicket = {
  category: 'COLLECTIVE';
  ticketCode: string;
  ticketCodeType: 'QR_CODE';
};

const normalizeParam = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const respondWithError = (res: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const details = error instanceof HttpError ? error.details : null;
  const explicitErrorCode =
    details && typeof details === 'object' && !Array.isArray(details) && typeof (details as { errorCode?: unknown }).errorCode === 'string'
      ? String((details as { errorCode?: unknown }).errorCode)
      : null;
  const lowerMessage = message.toLowerCase();
  const inferredErrorCode =
    explicitErrorCode ??
    (lowerMessage.includes('ticket category')
      ? 'INVALID_TICKET_CATEGORY'
      : lowerMessage.includes('participants')
        ? 'INVALID_PARTICIPANTS_CONFIGURATION'
        : lowerMessage.includes('product')
          ? 'INVALID_PRODUCT'
          : lowerMessage.includes('availability')
            ? 'NO_AVAILABILITY'
            : 'INTERNAL_SYSTEM_FAILURE');

  const status = error instanceof HttpError ? error.status : 500;
  res.status(status).json({ errorCode: inferredErrorCode, errorMessage: message });
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

const buildReservationResponse = (reservationReference: string): { data: { reservationReference: string; reservationExpiration: string } } => {
  return {
    data: {
      reservationReference,
      reservationExpiration: new Date(Date.now() + 60 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, '+00:00'),
    },
  };
};

const buildBookingResponse = (bookingReference: string): { data: { bookingReference: string; tickets: GygBookingTicket[] } } => {
  return {
    data: {
      bookingReference,
      tickets: [
        {
          category: 'COLLECTIVE',
          ticketCode: bookingReference,
          ticketCodeType: 'QR_CODE',
        },
      ],
    },
  };
};

const buildEmptySuccessResponse = (): { data: Record<string, never> } => {
  return { data: {} };
};

const ingestWithOperation = async (req: Request, res: Response, operation: 'reserve' | 'cancel' | 'upsert'): Promise<void> => {
  try {
    const requestedPlatformBookingId = resolveRequestedPlatformBookingId(req);
    const result = await ingestGetYourGuidePayload(req.body, {
      operation,
      requestedPlatformBookingId,
    });

    if (operation === 'reserve') {
      res.status(200).json(buildReservationResponse(result.booking.platformOrderId ?? result.booking.platformBookingId));
      return;
    }

    if (operation === 'upsert') {
      res.status(200).json(buildBookingResponse(result.booking.platformBookingId));
      return;
    }

    res.status(200).json(buildEmptySuccessResponse());
  } catch (error) {
    respondWithError(res, error);
  }
};

export const healthCheck = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ data: { ok: true, service: 'getyourguide' } });
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
      data: {
        ok: true,
        booking,
      },
    });
  } catch (error) {
    respondWithError(res, error);
  }
};

export const getAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getGetYourGuideAvailabilities(req.query as Record<string, unknown>);
    res.status(200).json({ data: result });
  } catch (error) {
    respondWithError(res, error);
  }
};
