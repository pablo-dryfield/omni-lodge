import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import { Op } from 'sequelize';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { Env } from '../types/Env.js';

const NAME_TO_SLUG: Record<string, string[]> = {
  guide: ['guide', 'pub-crawl-guide'],
  'pub crawl guide': ['pub-crawl-guide'],
  'pub_crawl_guide': ['pub-crawl-guide'],
  admin: ['admin', 'administrator'],
  administrator: ['administrator', 'admin'],
  manager: ['manager'],
  'assistant manager': ['assistant-manager'],
  'assistant-manager': ['assistant-manager'],
  'assistant_manager': ['assistant-manager'],
  'assistantmanager': ['assistant-manager'],
  owner: ['owner'],
};

declare const process: {
  env: Env;
};

function buildUserColumns() {
  const attributes = User.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
}

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
      expiresIn: '7d',
    });

    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: oneWeekMs,
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
    const format = (req.query.format ?? req.query.view ?? '').toString().toLowerCase();
    const activeParam = typeof req.query.active === 'string' ? req.query.active.trim().toLowerCase() : undefined;
    const filterActive = activeParam === 'true';

    if (format === 'compact') {
      const typeFilter = typeof req.query.types === 'string' ? req.query.types : undefined;
      const typeSlugs = typeFilter
        ? typeFilter
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .flatMap((value) => NAME_TO_SLUG[value] ?? [value])
            .map((slug) => slug.trim().toLowerCase())
            .filter((slug) => slug.length > 0)
        : [];

      const normalizedSlugs = Array.from(
        new Set(
          typeSlugs.flatMap((slug) => {
            const lowered = slug.toLowerCase();
            const hyphenated = lowered.replace(/_/g, '-');
            const underscored = lowered.replace(/-/g, '_');
            return [lowered, hyphenated, underscored];
          }),
        ),
      );

      const userWhere: Record<string, unknown> = {};
      if (filterActive || normalizedSlugs.length > 0) {
        userWhere.status = true;
      }

      const users = await User.findAll({
        where: userWhere,
        include: [
          {
            model: UserType,
            as: 'role',
            required: normalizedSlugs.length > 0,
            where:
              normalizedSlugs.length > 0
                ? {
                    slug: {
                      [Op.in]: normalizedSlugs,
                    },
                  }
                : undefined,
          },
        ],
        order: [['firstName', 'ASC']],
      });

      const payload = users.map((user) => {
        const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        const role = (user as unknown as { role?: UserType }).role;
        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName,
          userTypeId: user.userTypeId,
          userTypeSlug: role?.slug ?? null,
          userTypeName: role?.name ?? null,
        };
      });

      res.status(200).json(payload);
      return;
    }

    const regularWhere: Record<string, unknown> = {};
    if (filterActive) {
      regularWhere.status = true;
    }
    const regularWhereOptions = Object.keys(regularWhere).length > 0 ? { where: regularWhere } : {};
    const data = await User.findAll(regularWhereOptions);
    res.status(200).json([{ data, columns: buildUserColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getAllActiveUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await User.findAll({ where: { status: true } });
    res.status(200).json([{ data, columns: buildUserColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = await User.findByPk(id);

    if (!data) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    res.status(200).json([{ data, columns: buildUserColumns() }]);
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
