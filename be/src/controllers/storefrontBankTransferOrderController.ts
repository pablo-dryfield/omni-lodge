import type { NextFunction, Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getAllowedProductTypeIds } from '../services/productScopeService.js';
import { loadStorefrontProducts } from './storefrontController.js';
import {
  cancelBankTransferOrder,
  createBankTransferOrder,
  listBankTransferOrders,
  receiveBankTransferOrder,
  resendBankTransferCancellation,
  resendBankTransferInstructions,
  retryBankTransferConfirmation,
  serializeBankTransferOrder,
} from '../services/storefrontBankTransferOrderService.js';

const actorId = (request: AuthenticatedRequest): number => {
  const id = Number(request.authContext?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(401, 'Unauthorized.');
  return id;
};

export const listStorefrontBankTransferCatalog = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    response.set('Cache-Control', 'private, no-store');
    response.json({
      version: 3,
      products: await loadStorefrontProducts(await getAllowedProductTypeIds(request)),
    });
  } catch (error) {
    next(error);
  }
};

export const listStorefrontBankTransferOrders = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    response.set('Cache-Control', 'private, no-store');
    const data = await listBankTransferOrders(
      await getAllowedProductTypeIds(request),
      { includeCancelled: request.query.includeCancelled === 'true' },
    );
    response.json({ data });
  } catch (error) {
    next(error);
  }
};

export const createStorefrontBankTransferOrder = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await createBankTransferOrder({
      actorId: actorId(request),
      allowedProductTypeIds: await getAllowedProductTypeIds(request),
      clientRequestId: request.body?.clientRequestId,
      customer: request.body?.customer,
      cart: request.body?.cart,
    });
    response.status(result.created ? 201 : 200).json({
      data: await serializeBankTransferOrder(result.order),
      ...(result.emailError ? { warning: result.emailError } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const markStorefrontBankTransferPaymentReceived = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const order = await receiveBankTransferOrder({
      actorId: actorId(request),
      allowedProductTypeIds: await getAllowedProductTypeIds(request),
      publicId: request.params.publicId,
      paymentReference: request.body?.paymentReference,
      note: request.body?.note,
      clientRequestId: request.body?.clientRequestId,
    });
    response.json({ data: await serializeBankTransferOrder(order) });
  } catch (error) {
    next(error);
  }
};

export const resendStorefrontBankTransferInstructions = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const order = await resendBankTransferInstructions(
      request.params.publicId,
      actorId(request),
      await getAllowedProductTypeIds(request),
    );
    response.json({ data: await serializeBankTransferOrder(order) });
  } catch (error) {
    next(error);
  }
};

export const retryStorefrontBankTransferConfirmation = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const order = await retryBankTransferConfirmation(
      request.params.publicId,
      actorId(request),
      await getAllowedProductTypeIds(request),
    );
    response.json({ data: await serializeBankTransferOrder(order) });
  } catch (error) {
    next(error);
  }
};

export const cancelStorefrontBankTransferOrder = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await cancelBankTransferOrder({
      actorId: actorId(request),
      allowedProductTypeIds: await getAllowedProductTypeIds(request),
      publicId: request.params.publicId,
      note: request.body?.note,
    });
    response.json({
      data: await serializeBankTransferOrder(result.order),
      ...(result.emailError ? { warning: result.emailError } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const resendStorefrontBankTransferCancellation = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const order = await resendBankTransferCancellation(
      request.params.publicId,
      actorId(request),
      await getAllowedProductTypeIds(request),
    );
    response.json({ data: await serializeBankTransferOrder(order) });
  } catch (error) {
    next(error);
  }
};
