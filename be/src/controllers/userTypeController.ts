import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import UserType from '../models/UserType.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

// Get All UserTypes
export const getAllUserTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await UserType.findAll();
    const attributes = UserType.getAttributes();
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

// Get UserType by ID
export const getUserTypeById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await UserType.findByPk(id);
    const attributes = UserType.getAttributes();
    const columns = Object.entries(attributes)
      .map(([key, attribute]) => {
        return {
          header: key.charAt(0).toUpperCase() + key.slice(1),
          accessorKey: key,
          type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
        };
      });
    if (!data) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Create New UserType
export const createUserType= async (req: Request, res: Response): Promise<void> => {
  try {
    const newUserType = await UserType.create(req.body);
    res.status(201).json([newUserType]);
  } catch (error) {
    const e = error as ErrorWithMessage;
    res.status(500).json([{ message: e.message }]);
  }
};

// Update UserType
export const updateUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await UserType.update(req.body, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    const updatedUserType = await UserType.findByPk(id);
    res.status(200).json([updatedUserType]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Delete UserType
export const deleteUserType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await UserType.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'UserType not found' }]);
      return;
    }

    res.status(204).send(); // Properly using send() for a 204 response
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};
