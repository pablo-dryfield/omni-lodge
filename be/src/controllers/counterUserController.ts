import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import CounterUser from '../models/CounterUser.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import User from '../models/User.js';

// Get All CounterUsers
export const getAllCounterUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await CounterUser.findAll({
      include: [
        {
          model: User,
          as: 'counterUser',
          attributes: ['firstName']
        },
      ]
    });
    const attributes = CounterUser.getAttributes();
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

// Get CounterUser by ID
export const getCounterUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await CounterUser.findByPk(id);
    const attributes = CounterUser.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    if (!data) {
      res.status(404).json([{ message: 'CounterUser not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Create New Counter User
export const createCounterUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const newCounterUser = await CounterUser.create(req.body);
    res.status(201).json([newCounterUser]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Create New Counter User
export const createBulkCounterUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const counterUsers = req.body.data;

    if (!Array.isArray(counterUsers) || counterUsers.length === 0) {
      res.status(400).json([{ message: 'Invalid data format or empty data array' }]);
      return; // Ensure no further code is executed
    }

    // Using bulkCreate to create multiple records at once
    const newCounterUsers = await CounterUser.bulkCreate(counterUsers, {
      validate: true, // Ensures all records are validated
      individualHooks: true, // Runs individual hooks (like beforeCreate) on each record
    });

    // Respond with the created records
    res.status(201).json(newCounterUsers);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update CounterUser
export const updateCounterUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await CounterUser.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'CounterUser not found' }]);
      return;
    }

    const updatedCounterUser = await CounterUser.findByPk(id);
    res.status(200).json([updatedCounterUser]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Delete CounterUser
export const deleteCounterUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await CounterUser.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'CounterUser not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
