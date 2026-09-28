import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import User from '../models/User.js';
import {
  completeWhatsAppEmbeddedSignupAttempt,
  createWhatsAppEmbeddedSignupAttempt,
  getWhatsAppAdminStatus,
  repairWhatsAppWebhookSubscription,
} from '../services/whatsappEmbeddedSignupService.js';
import {
  listWhatsAppMessageTemplates,
  sendWhatsAppTemplateMessage,
} from '../services/whatsappOutboundMessageService.js';
import {
  archiveManagedWhatsAppTemplates,
  createManagedWhatsAppTemplate,
  deleteManagedWhatsAppTemplate,
  getManagedWhatsAppTemplateEvents,
  listManagedWhatsAppTemplates,
  previewManagedWhatsAppTemplate,
  sendManagedWhatsAppTemplate,
  syncManagedWhatsAppTemplates,
  unarchiveManagedWhatsAppTemplates,
  unpauseManagedWhatsAppTemplate,
  updateManagedWhatsAppTemplate,
} from '../services/whatsappTemplateManagementService.js';
import {
  listWhatsAppTemplateVariables,
  searchWhatsAppTemplateBookings,
  WhatsAppTemplateVariableError,
} from '../services/whatsappTemplateVariableService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const noStore = (res: Response): void => {
  res.set('Cache-Control', 'no-store');
};

const SAFE_ERROR_CODE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    const details = error.details !== null && typeof error.details === 'object'
      && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : null;
    const code = typeof details?.code === 'string' && SAFE_ERROR_CODE.test(details.code)
      ? details.code
      : null;
    const safeDetails = {
      ...(code === null ? {} : { code }),
      ...(details?.ambiguous === true ? { ambiguous: true } : {}),
    };
    res.status(error.status).json([{
      message: error.message,
      ...(Object.keys(safeDetails).length === 0 ? {} : { details: safeDetails }),
    }]);
    return;
  }
  res.status(500).json([{ message: 'Unexpected server error.' }]);
};

const passwordConfirmed = async (
  req: AuthenticatedRequest,
  password: unknown,
): Promise<boolean> => {
  const actorId = req.authContext?.id;
  if (!actorId || typeof password !== 'string' || password.trim().length === 0) {
    return false;
  }
  const user = await User.findByPk(actorId);
  return Boolean(user && await bcrypt.compare(password, user.password));
};

const templateVariableHttpError = (error: WhatsAppTemplateVariableError): HttpError => {
  const messages: Record<WhatsAppTemplateVariableError['code'], string> = {
    INVALID_BOOKING_ID: 'Booking ID is invalid.',
    INVALID_SEARCH_QUERY: 'Booking search is invalid.',
    BOOKING_NOT_FOUND: 'Booking was not found.',
    UNKNOWN_VARIABLE: 'The template uses a variable that is not available.',
    INVALID_POSITIONAL_BINDINGS: 'The template positional variable mapping is invalid.',
    INVALID_TEMPLATE_COMPONENT: 'The template contains an unsupported dynamic component.',
    MISSING_REQUIRED_VARIABLE: 'The selected booking is missing information required by this template.',
  };
  return new HttpError(error.code === 'BOOKING_NOT_FOUND' ? 404 : 400, messages[error.code], {
    code: error.code,
  });
};

const handleTemplateError = (res: Response, error: unknown): void => {
  handleError(
    res,
    error instanceof WhatsAppTemplateVariableError ? templateVariableHttpError(error) : error,
  );
};

const confirmedActor = async (
  req: AuthenticatedRequest,
  res: Response,
  action: string,
): Promise<number | null> => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    res.status(401).json([{ message: 'Unauthorized.' }]);
    return null;
  }
  if (!await passwordConfirmed(req, req.body?.password)) {
    res.status(403).json([{
      message: `Password confirmation is required to ${action}.`,
    }]);
    return null;
  }
  return actorId;
};

export const getWhatsAppAdminStatusController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({
      status: await getWhatsAppAdminStatus({ checkWebhookSubscription: true }),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const repairWhatsAppWebhookSubscriptionController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    if (!await passwordConfirmed(req, req.body?.password)) {
      res.status(403).json([{
        message: 'Password confirmation is required to repair the WhatsApp webhook subscription.',
      }]);
      return;
    }
    res.json(await repairWhatsAppWebhookSubscription());
  } catch (error) {
    handleError(res, error);
  }
};

export const createWhatsAppEmbeddedSignupAttemptController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    if (!await passwordConfirmed(req, req.body?.password)) {
      res.status(403).json([{
        message: 'Password confirmation is required to start WhatsApp Embedded Signup.',
      }]);
      return;
    }
    const adminUserId = req.authContext?.id;
    if (!adminUserId) {
      res.status(401).json([{ message: 'Unauthorized.' }]);
      return;
    }
    const payload = await createWhatsAppEmbeddedSignupAttempt(
      adminUserId,
      undefined,
      req.body?.reconnectAfterOffboarding === true,
    );
    res.status(201).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const completeWhatsAppEmbeddedSignupAttemptController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const adminUserId = req.authContext?.id;
    const attemptId = req.params.id;
    if (!adminUserId || !attemptId) {
      res.status(401).json([{ message: 'Unauthorized.' }]);
      return;
    }
    const status = await completeWhatsAppEmbeddedSignupAttempt({
      attemptId,
      adminUserId,
      nonce: req.body?.nonce,
      code: req.body?.code,
      session: req.body?.session,
    });
    res.json({ status });
  } catch (error) {
    handleError(res, error);
  }
};

export const sendWhatsAppTemplateMessageController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    if (!await passwordConfirmed(req, req.body?.password)) {
      res.status(403).json([{
        message: 'Password confirmation is required to send a WhatsApp message.',
      }]);
      return;
    }
    const result = await sendWhatsAppTemplateMessage({
      recipient: req.body?.recipient,
      templateName: req.body?.templateName,
      languageCode: req.body?.languageCode,
    });
    res.status(202).json(result);
  } catch (error) {
    handleError(res, error);
  }
};

export const getWhatsAppMessageTemplatesController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({ templates: await listWhatsAppMessageTemplates() });
  } catch (error) {
    handleError(res, error);
  }
};

export const listManagedWhatsAppTemplatesController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({ templates: await listManagedWhatsAppTemplates() });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const syncManagedWhatsAppTemplatesController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, 'synchronize WhatsApp templates');
    if (actorId === null) return;
    res.json({ templates: await syncManagedWhatsAppTemplates(actorId) });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const createManagedWhatsAppTemplateController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, 'create a WhatsApp template');
    if (actorId === null) return;
    const { password: _password, ...definition } = req.body ?? {};
    res.status(201).json({
      template: await createManagedWhatsAppTemplate(definition, actorId),
    });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const updateManagedWhatsAppTemplateController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, 'update a WhatsApp template');
    if (actorId === null) return;
    const { password: _password, ...definition } = req.body ?? {};
    res.json({
      template: await updateManagedWhatsAppTemplate(req.params.id, definition, actorId),
    });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const deleteManagedWhatsAppTemplateController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, 'delete a WhatsApp template');
    if (actorId === null) return;
    await deleteManagedWhatsAppTemplate(req.params.id, req.body?.name, actorId);
    res.json({ deleted: true });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

const bulkTemplateLifecycleController = (
  action: 'archive' | 'unarchive',
) => async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, `${action} WhatsApp templates`);
    if (actorId === null) return;
    const operation = action === 'archive'
      ? archiveManagedWhatsAppTemplates
      : unarchiveManagedWhatsAppTemplates;
    res.json({ templates: await operation(req.body?.templateIds, actorId) });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const archiveManagedWhatsAppTemplatesController =
  bulkTemplateLifecycleController('archive');

export const unarchiveManagedWhatsAppTemplatesController =
  bulkTemplateLifecycleController('unarchive');

export const unpauseManagedWhatsAppTemplateController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, 'unpause a WhatsApp template');
    if (actorId === null) return;
    res.json({
      template: await unpauseManagedWhatsAppTemplate(req.params.id, actorId),
    });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const getManagedWhatsAppTemplateEventsController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({ events: await getManagedWhatsAppTemplateEvents(req.params.id) });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const getWhatsAppTemplateVariablesController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  res.json({ variables: listWhatsAppTemplateVariables() });
};

export const searchWhatsAppTemplateBookingsController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({
      bookings: await searchWhatsAppTemplateBookings(String(req.body?.q ?? '')),
    });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const previewManagedWhatsAppTemplateController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({
      preview: await previewManagedWhatsAppTemplate({
        metaTemplateId: req.body?.metaTemplateId,
        definition: req.body?.definition,
        bookingId: req.body?.bookingId,
      }),
    });
  } catch (error) {
    handleTemplateError(res, error);
  }
};

export const sendManagedWhatsAppTemplateController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const actorId = await confirmedActor(req, res, 'send a WhatsApp template message');
    if (actorId === null) return;
    const result = await sendManagedWhatsAppTemplate({
      metaTemplateId: req.params.id,
      bookingId: req.body?.bookingId,
      recipient: req.body?.recipient,
      actorId,
    });
    res.status(202).json(result);
  } catch (error) {
    handleTemplateError(res, error);
  }
};
