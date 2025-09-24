import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import User from '../models/User.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { Env } from '../types/Env.js';
import { Op } from 'sequelize';

declare const process: {
  env: Env;
};

export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = { ...req.body };

    const salt = await bcrypt.genSalt(10);
    data.password = await bcrypt.hash(data.password, salt);

    const newUser = await User.create(data);

    res.status(201).json([newUser]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      where: {
        [Op.or]: [{ email }, { username: email }],
      },
    });

    if (!user) {
      res.status(404).json([{ message: 'Account not found. Double-check the username or email.' }]);
      return;
    }

    if (!user.status) {
      res.status(403).json([{ message: 'This account is inactive. Contact an administrator for access.' }]);
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(400).json([{ message: 'Password is incorrect. Please try again.' }]);
      return;
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 3600000,
    });
    res.status(200).json([{ message: 'Logged in successfully', userId: user.id }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const logoutUser = async (req: Request, res: Response): Promise<void> => {
  try {
    res.cookie('token', '', {
      expires: new Date(0),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    res.status(200).json([{ message: 'Logged out successfully' }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await User.findAll();
    const attributes = User.getAttributes();
    const columns = Object.entries(attributes).map(([key, attribute]) => {
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

export const getAllActiveUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await User.findAll({
      where: { status: true },
    });
    const attributes = User.getAttributes();
    const columns = Object.entries(attributes).map(([key, attribute]) => {
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

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await User.findByPk(id);
    const attributes = User.getAttributes();
    const columns = Object.entries(attributes).map(([key, attribute]) => {
      return {
        header: key.charAt(0).toUpperCase() + key.slice(1),
        accessorKey: key,
        type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
      };
    });
    if (!data) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }
    res.status(200).json([{ data, columns }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = { ...req.body };

    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(data.password, salt);
    }

    const [updated] = await User.update(data, { where: { id } });

    if (!updated) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    const updatedUser = await User.findByPk(id);
    res.status(200).json([updatedUser]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await User.destroy({ where: { id } });

    if (!deleted) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};