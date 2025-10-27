import { Request, Response } from 'express';
import FinanceManagementRequest from '../models/FinanceManagementRequest.js';
import { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { applyManagementRequest } from '../services/managementRequestService.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

function requireActor(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new Error('Missing authenticated user');
  }
  return actorId;
}

export const listManagementRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status?.toString();
    const filters = status ? { status } : undefined;
    const requests = await FinanceManagementRequest.findAll({
      where: filters,
      order: [
        ['priority', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getManagementRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const request = await FinanceManagementRequest.findByPk(req.params.id);
    if (!request) {
      res.status(404).json([{ message: 'Management request not found' }]);
      return;
    }
    res.status(200).json(request);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createManagementRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const payload = {
      ...req.body,
      requestedBy: actorId,
    };
    const request = await FinanceManagementRequest.create(payload);
    await recordFinanceAuditLog({
      entity: 'finance_management_request',
      entityId: request.id,
      action: 'create',
      performedBy: actorId,
      changes: request.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(request);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const updateManagementRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const [count] = await FinanceManagementRequest.update(req.body, { where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Management request not found' }]);
      return;
    }
    const updated = await FinanceManagementRequest.findByPk(req.params.id);
    res.status(200).json(updated);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const approveManagementRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const request = await FinanceManagementRequest.findByPk(req.params.id);
    if (!request) {
      res.status(404).json([{ message: 'Management request not found' }]);
      return;
    }
    if (request.status !== 'open' && request.status !== 'returned') {
      res.status(400).json([{ message: 'Request already processed' }]);
      return;
    }

    await applyManagementRequest(request, actorId);

    request.status = 'approved';
    request.managerId = actorId;
    request.decisionNote = req.body?.decisionNote ?? null;
    await request.save();

    await recordFinanceAuditLog({
      entity: 'finance_management_request',
      entityId: request.id,
      action: 'approved',
      performedBy: actorId,
      metadata: {
        decisionNote: request.decisionNote,
      },
    });

    res.status(200).json(request);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const returnManagementRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const request = await FinanceManagementRequest.findByPk(req.params.id);
    if (!request) {
      res.status(404).json([{ message: 'Management request not found' }]);
      return;
    }
    request.status = 'returned';
    request.managerId = actorId;
    request.decisionNote = req.body?.decisionNote ?? null;
    await request.save();

    await recordFinanceAuditLog({
      entity: 'finance_management_request',
      entityId: request.id,
      action: 'returned',
      performedBy: actorId,
      metadata: {
        decisionNote: request.decisionNote,
      },
    });

    res.status(200).json(request);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const rejectManagementRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const request = await FinanceManagementRequest.findByPk(req.params.id);
    if (!request) {
      res.status(404).json([{ message: 'Management request not found' }]);
      return;
    }
    request.status = 'rejected';
    request.managerId = actorId;
    request.decisionNote = req.body?.decisionNote ?? null;
    await request.save();

    await recordFinanceAuditLog({
      entity: 'finance_management_request',
      entityId: request.id,
      action: 'rejected',
      performedBy: actorId,
      metadata: {
        decisionNote: request.decisionNote,
      },
    });

    res.status(200).json(request);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};
