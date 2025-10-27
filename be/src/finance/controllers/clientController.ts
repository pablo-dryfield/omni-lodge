import { Request, Response } from 'express';
import { Op } from 'sequelize';
import FinanceClient from '../models/FinanceClient.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

export const listClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const onlyActive = (req.query.active ?? '').toString().toLowerCase() === 'true';
    const clients = await FinanceClient.findAll({
      where: onlyActive ? { isActive: true } : undefined,
      order: [['name', 'ASC']],
    });
    res.status(200).json(clients);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const searchClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q?.toString() ?? '';
    const clients = await FinanceClient.findAll({
      where: {
        name: { [Op.iLike]: `%${query}%` },
      },
      order: [['name', 'ASC']],
      limit: 25,
    });
    res.status(200).json(clients);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const client = await FinanceClient.findByPk(req.params.id);
    if (!client) {
      res.status(404).json([{ message: 'Client not found' }]);
      return;
    }
    res.status(200).json(client);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const client = await FinanceClient.create(req.body);
    await recordFinanceAuditLog({
      entity: 'finance_client',
      entityId: client.id,
      action: 'create',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
      changes: client.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(client);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const [count] = await FinanceClient.update(req.body, { where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Client not found' }]);
      return;
    }
    const updated = await FinanceClient.findByPk(req.params.id);
    if (updated) {
      await recordFinanceAuditLog({
        entity: 'finance_client',
        entityId: updated.id,
        action: 'update',
        performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
        changes: req.body,
      });
    }
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const deleteClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceClient.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Client not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_client',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

