import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import CounterProduct from '../models/CounterProduct.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

// Get All CounterProducts
export const getAllCounterProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await CounterProduct.findAll();
    const attributes = CounterProduct.getAttributes();
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

// Get CounterProduct by ID
export const getCounterProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await CounterProduct.findByPk(id);
    const attributes = CounterProduct.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    if (!data) {
      res.status(404).json([{ message: 'CounterProduct not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Create New Counter Product
export const createCounterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const newCounterProduct = await CounterProduct.create(req.body);
    res.status(201).json([newCounterProduct]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Create New Counter Product
export const createBulkCounterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const counterProducts = req.body.data;

    if (!Array.isArray(counterProducts) || counterProducts.length === 0) {
      res.status(400).json([{ message: 'Invalid data format or empty data array' }]);
      return; // Ensure no further code is executed
    }

    // Using bulkCreate to create multiple records at once
    const newCounterProducts = await CounterProduct.bulkCreate(counterProducts, {
      validate: true, // Ensures all records are validated
      individualHooks: true, // Runs individual hooks (like beforeCreate) on each record
    });

    // Respond with the created records
    res.status(201).json(newCounterProducts);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update CounterProduct
export const updateCounterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await CounterProduct.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'CounterProduct not found' }]);
      return;
    }

    const updatedCounterProduct = await CounterProduct.findByPk(id);
    res.status(200).json([updatedCounterProduct]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Delete CounterProduct
export const deleteCounterProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await CounterProduct.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'CounterProduct not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
