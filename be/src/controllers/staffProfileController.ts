import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const STAFF_TYPE_OPTIONS: Array<StaffProfile['staffType']> = ['volunteer', 'long_term'];

type ColumnConfig = {
  header: string;
  accessorKey: string;
  type?: 'date' | 'text' | 'boolean';
};

const buildStaffProfileColumns = (): ColumnConfig[] => {
  const attributes = StaffProfile.getAttributes();
  const baseColumns: ColumnConfig[] = Object.entries(attributes).map(([key, attribute]) => {
    const column: ColumnConfig = {
      header: key.charAt(0).toUpperCase() + key.slice(1),
      accessorKey: key,
    };
    if (attribute.type instanceof DataType.DATE) {
      column.type = 'date';
    } else if (key === 'livesInAccom' || key === 'active') {
      column.type = 'boolean';
    } else {
      column.type = 'text';
    }
    return column;
  });

  const supplemental: ColumnConfig[] = [
    { header: 'User Name', accessorKey: 'userName', type: 'text' },
    { header: 'User Email', accessorKey: 'userEmail', type: 'text' },
    { header: 'User Status', accessorKey: 'userStatus', type: 'boolean' },
  ];

  return [...baseColumns, ...supplemental];
};

const formatProfilePayload = (profile: StaffProfile & { user?: User | null }) => {
  const plain = profile.get({ plain: true }) as StaffProfile & { user?: User | null };
  const user = plain.user;
  const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  const profilePhotoUrl = user?.profilePhotoUrl ?? null;

  return {
    userId: plain.userId,
    staffType: plain.staffType,
    livesInAccom: plain.livesInAccom,
    active: plain.active,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    userName: fullName.length > 0 ? fullName : null,
    userEmail: user?.email ?? null,
    userStatus: user?.status ?? null,
    profilePhotoUrl,
  };
};

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === '1') {
      return true;
    }
    if (trimmed === 'false' || trimmed === '0') {
      return false;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return undefined;
};

const normalizeStaffType = (value: unknown): StaffProfile['staffType'] | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return STAFF_TYPE_OPTIONS.find((option) => option === normalized) ?? undefined;
};

export const listStaffProfiles = async (req: Request, res: Response): Promise<void> => {
  try {
    const profiles = await StaffProfile.findAll({
      include: [{ model: User, as: 'user' }],
      order: [['userId', 'ASC']],
    });
    const payload = profiles.map((profile) => formatProfilePayload(profile));
    res.status(200).json([{ data: payload, columns: buildStaffProfileColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getStaffProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const profile = await StaffProfile.findByPk(Number(userId), {
      include: [{ model: User, as: 'user' }],
    });

    if (!profile) {
      res.status(404).json([{ message: 'Staff profile not found' }]);
      return;
    }

    res.status(200).json([{ data: formatProfilePayload(profile), columns: buildStaffProfileColumns() }]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const createStaffProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = Number(req.body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json([{ message: 'A valid userId is required.' }]);
      return;
    }

    const staffType = normalizeStaffType(req.body.staffType);
    if (!staffType) {
      res.status(400).json([{ message: `staffType must be one of: ${STAFF_TYPE_OPTIONS.join(', ')}` }]);
      return;
    }

    const user = await User.findByPk(userId);
    if (!user) {
      res.status(404).json([{ message: `User ${userId} not found` }]);
      return;
    }

    const existing = await StaffProfile.findByPk(userId);
    if (existing) {
      res.status(409).json([{ message: `Staff profile already exists for user ${userId}` }]);
      return;
    }

    const livesInAccom = normalizeBoolean(req.body.livesInAccom) ?? false;
    const active = normalizeBoolean(req.body.active);

    const profile = await StaffProfile.create({
      userId,
      staffType,
      livesInAccom,
      active: active ?? true,
    });

    res.status(201).json([profile]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const updateStaffProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json([{ message: 'A valid userId is required.' }]);
      return;
    }

    const updates: Partial<StaffProfile> = {};

    if (req.body.staffType !== undefined) {
      const staffType = normalizeStaffType(req.body.staffType);
      if (!staffType) {
        res.status(400).json([{ message: `staffType must be one of: ${STAFF_TYPE_OPTIONS.join(', ')}` }]);
        return;
      }
      updates.staffType = staffType;
    }

    if (req.body.livesInAccom !== undefined) {
      const livesInAccom = normalizeBoolean(req.body.livesInAccom);
      if (livesInAccom === undefined) {
        res.status(400).json([{ message: 'livesInAccom must be a boolean value.' }]);
        return;
      }
      updates.livesInAccom = livesInAccom;
    }

    if (req.body.active !== undefined) {
      const active = normalizeBoolean(req.body.active);
      if (active === undefined) {
        res.status(400).json([{ message: 'active must be a boolean value.' }]);
        return;
      }
      updates.active = active;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json([{ message: 'No valid fields provided for update.' }]);
      return;
    }

    const [updated] = await StaffProfile.update(updates, { where: { userId } });
    if (!updated) {
      res.status(404).json([{ message: 'Staff profile not found' }]);
      return;
    }

    const profile = await StaffProfile.findByPk(userId, {
      include: [{ model: User, as: 'user' }],
    });

    res.status(200).json([profile]);
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const deleteStaffProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json([{ message: 'A valid userId is required.' }]);
      return;
    }

    const deleted = await StaffProfile.destroy({ where: { userId } });
    if (!deleted) {
      res.status(404).json([{ message: 'Staff profile not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json([{ message: errorMessage }]);
  }
};

export const getMyStaffProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.authContext?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const profile = await StaffProfile.findByPk(userId, {
      include: [{ model: User, as: 'user' }],
    });
    if (!profile) {
      const user = await User.findByPk(userId);
      res.status(200).json({
        userId,
        staffType: null,
        livesInAccom: false,
        active: false,
        profilePhotoUrl: user?.profilePhotoUrl ?? null,
      });
      return;
    }

    const profileJson = profile.get({ plain: true }) as StaffProfile & { user?: User | null };
    res.status(200).json({
      userId: profile.userId,
      staffType: profile.staffType,
      livesInAccom: profile.livesInAccom,
      active: profile.active,
      profilePhotoUrl: profileJson.user?.profilePhotoUrl ?? null,
    });
  } catch (error) {
    const errorMessage = (error as ErrorWithMessage).message;
    res.status(500).json({ error: errorMessage });
  }
};
