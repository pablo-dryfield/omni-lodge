import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Counter from '../models/Counter.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import User from '../models/User.js';
import sequelize from '../config/database.js';
import CounterProduct from '../models/CounterProduct.js';
import CounterUser from '../models/CounterUser.js';

// Get All Counters
export const getAllCounters = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Counter.findAll({
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['firstName']
        },
        {
          model: User,
          as: 'createdByUser',
          attributes: ['firstName']
        },
        {
          model: User,
          as: 'updatedByUser',
          attributes: ['firstName']
        }
      ]
    });
    const attributes = Counter.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Get Counter by ID
export const getCounterById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Counter.findByPk(id);
    const attributes = Counter.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    if (!data) {
      res.status(404).json([{ message: 'Counter not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Create New Counter
export const createCounter = async (req: Request, res: Response): Promise<void> => {
  try {
    const newCounter = await Counter.create(req.body);
    res.status(201).json([newCounter]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update Counter
export const updateCounter = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Counter.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Counter not found' }]);
      return;
    }

    const updatedCounter = await Counter.findByPk(id);
    res.status(200).json([updatedCounter]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Delete Counter
export const deleteCounter = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const counterProductDeleted = await CounterProduct.destroy({ where: { counterId: id } });
    const counterUserDeleted = await CounterUser.destroy({ where: { counterId: id } });
    const deleted = await Counter.destroy({ where: { id } });

    if (!deleted || !counterProductDeleted || !counterUserDeleted) {
      res.status(404).json([{ message: 'Counter not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
