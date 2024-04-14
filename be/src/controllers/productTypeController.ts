import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import ProductType from '../models/ProductType.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

// Get All ProductTypes
export const getAllProductTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await ProductType.findAll();
    const attributes = ProductType.getAttributes();
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

// Get ProductType by ID
export const getProductTypeById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await ProductType.findByPk(id);
    const attributes = ProductType.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    if (!data) {
      res.status(404).json([{ message: 'ProductType not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Create New ProductType
export const createProductType = async (req: Request, res: Response): Promise<void> => {
  try {
    const newProductType = await ProductType.create(req.body);
    res.status(201).json([newProductType]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update ProductType
export const updateProductType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await ProductType.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'ProductType not found' }]);
      return;
    }

    const updatedProductType = await ProductType.findByPk(id);
    res.status(200).json([updatedProductType]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Delete ProductType
export const deleteProductType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await ProductType.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'ProductType not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
