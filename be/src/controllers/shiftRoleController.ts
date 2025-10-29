import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import ShiftRole from '../models/ShiftRole.js';
import User from '../models/User.js';
import UserShiftRole from '../models/UserShiftRole.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const buildShiftRoleColumns = () => [
  {
    header: 'ID',
    accessorKey: 'id',
    type: 'number',
  },
  {
    header: 'Name',
    accessorKey: 'name',
    type: 'text',
  },
  {
    header: 'Slug',
    accessorKey: 'slug',
    type: 'text',
  },
];

const buildAssignmentColumns = () => [
  { header: 'User ID', accessorKey: 'userId', type: 'number' },
  { header: 'First Name', accessorKey: 'firstName', type: 'text' },
  { header: 'Last Name', accessorKey: 'lastName', type: 'text' },
  { header: 'Role IDs', accessorKey: 'roleIds', type: 'json' },
];

export const listShiftRoles = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await ShiftRole.findAll({ order: [['name', 'ASC']] });
    res.json([{ data, columns: buildShiftRoleColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createShiftRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, slug } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json([{ message: 'Name is required.' }]);
      return;
    }
    const normalizedSlug = typeof slug === 'string' && slug.trim().length > 0 ? slugify(slug) : slugify(name);
    const role = await ShiftRole.create({ name: name.trim(), slug: normalizedSlug });
    res.status(201).json([role]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateShiftRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const role = await ShiftRole.findByPk(Number(id));
    if (!role) {
      res.status(404).json([{ message: 'Shift role not found' }]);
      return;
    }
    const { name, slug } = req.body ?? {};
    const data: Partial<ShiftRole> = {};
    if (typeof name === 'string' && name.trim().length > 0) {
      data.name = name.trim();
    }
    if (typeof slug === 'string' && slug.trim().length > 0) {
      data.slug = slugify(slug);
    } else if (data.name) {
      data.slug = slugify(data.name);
    }
    if (Object.keys(data).length === 0) {
      res.status(400).json([{ message: 'Nothing to update.' }]);
      return;
    }
    await role.update(data);
    res.json([role]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteShiftRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const role = await ShiftRole.findByPk(Number(id));
    if (!role) {
      res.status(404).json([{ message: 'Shift role not found' }]);
      return;
    }
    await role.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const listUserShiftRoleAssignments = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.findAll({
      where: { status: true },
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
      attributes: ['id', 'firstName', 'lastName'],
      include: [{ model: ShiftRole, as: 'shiftRoles', through: { attributes: [] } }],
    });

    const payload = users.map((user) => ({
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      roleIds: (user.shiftRoles ?? []).map((role) => role.id),
    }));

    res.json([{ data: payload, columns: buildAssignmentColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateUserShiftRoles = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const parsedUserId = Number(userId);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    res.status(400).json([{ message: 'Invalid user id' }]);
    return;
  }

  const roleIds = Array.isArray(req.body?.roleIds) ? (req.body.roleIds as unknown[]) : [];
  const normalizedRoleIds = Array.from(
    new Set(
      roleIds
        .map((value: unknown) => Number(value))
        .filter((value): value is number => Number.isInteger(value) && value > 0),
    ),
  );

  try {
    const user = await User.findByPk(parsedUserId);
    if (!user) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }

    if (normalizedRoleIds.length > 0) {
      const roles = await ShiftRole.count({ where: { id: { [Op.in]: normalizedRoleIds } } });
      if (roles !== normalizedRoleIds.length) {
        res.status(400).json([{ message: 'One or more shift roles do not exist.' }]);
        return;
      }
    }

    await UserShiftRole.destroy({ where: { userId: parsedUserId } });

    if (normalizedRoleIds.length > 0) {
      const rows = normalizedRoleIds.map((roleId) => ({
        userId: parsedUserId,
        shiftRoleId: roleId,
      }));
      await UserShiftRole.bulkCreate(rows, { updateOnDuplicate: ['shiftRoleId'] });
    }

    const updatedAssignments = await UserShiftRole.findAll({
      where: { userId: parsedUserId },
      attributes: ['shiftRoleId'],
    });

    res.json([
      {
        userId: parsedUserId,
        roleIds: updatedAssignments.map((assignment) => assignment.shiftRoleId),
      },
    ]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};
