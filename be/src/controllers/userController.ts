import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // Adjust the import path as necessary
import bcrypt from 'bcryptjs';
import { DataType } from 'sequelize-typescript';
import { Request, Response } from 'express';

// Assuming you have an environment variable type definition
interface Env {
  JWT_SECRET: string;
}

interface ErrorWithMessage {
  message: string;
}

declare const process: {
  env: Env;
};

// Register New User
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, firstName, lastName, email, password } = req.body;

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      username,
      firstName,
      lastName,
      email,
      password: hashedPassword,
    });

    res.status(201).json([newUser]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Login User
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      res.status(400).json({ message: 'Invalid email or password' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(400).json({ message: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.status(200).json([{ token }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

// Get All Users
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await User.findAll();
    const attributes = User.getAttributes();
    const columns = Object.entries(attributes)
      //.filter(([key]) => key !== 'password') 
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

// Get User by ID
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json({ message: errorMessage });
  }
};

// Update User
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [updated] = await User.update(req.body, {
      where: { id },
    });

    if (!updated) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const updatedUser = await User.findByPk(id);
    res.status(200).json(updatedUser);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json({ message: errorMessage });
  }
};

// Delete User
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await User.destroy({
      where: { id },
    });

    if (!deleted) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(204).send(); // No content to send back
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json({ message: errorMessage });
  }
};
