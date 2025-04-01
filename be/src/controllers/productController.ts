import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import Product from '../models/Product.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

// Get All Products
export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await Product.findAll({
      where: { status: true },
    });
    const attributes = Product.getAttributes();
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

// Get Product by ID
export const getProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await Product.findByPk(id);
    const attributes = Product.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    if (!data) {
      res.status(404).json([{ message: 'Product not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Create New Product
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const newProduct = await Product.create(req.body);
    res.status(201).json([newProduct]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update Product
export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await Product.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'Product not found' }]);
      return;
    }

    const updatedProduct = await Product.findByPk(id);
    res.status(200).json([updatedProduct]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Delete Product
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await Product.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'Product not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
