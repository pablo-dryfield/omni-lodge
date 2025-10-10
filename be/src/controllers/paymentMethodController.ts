import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';

import PaymentMethod from '../models/PaymentMethod.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildPaymentMethodColumns = () => {
  const attributes = PaymentMethod.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

export const getAllPaymentMethods = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await PaymentMethod.findAll({ order: [['name', 'ASC']] });
    res.status(200).json([{ data, columns: buildPaymentMethodColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getPaymentMethodById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await PaymentMethod.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'Payment method not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildPaymentMethodColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createPaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await PaymentMethod.create({
      name: req.body.name,
      description: req.body.description ?? null,
    });
    res.status(201).json([created]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updatePaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await PaymentMethod.update(
      {
        name: req.body.name,
        description: req.body.description ?? null,
      },
      { where: { id } },
    );

    if (!updated) {
      res.status(404).json([{ message: 'Payment method not found' }]);
      return;
    }

    const data = await PaymentMethod.findByPk(id);
    res.status(200).json([data]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deletePaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await PaymentMethod.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Payment method not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

