import { Request, Response } from 'express';
import type { Includeable } from 'sequelize';
import { DataType } from 'sequelize-typescript';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import FinanceClient from '../finance/models/FinanceClient.js';

const STAFF_TYPE_OPTIONS: Array<StaffProfile['staffType']> = ['volunteer', 'long_term'];

type ColumnConfig = {
  header: string;
  accessorKey: string;
  type?: 'date' | 'text' | 'boolean';
};

const STAFF_PROFILE_INCLUDE: Includeable[] = [
  { model: User, as: 'user' },
  { model: FinanceVendor, as: 'financeVendor', attributes: ['id', 'name'] },
  { model: FinanceClient, as: 'financeClient', attributes: ['id', 'name'] },
];

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

const formatProfilePayload = (
  profile: StaffProfile & {
    user?: User | null;
    financeVendor?: FinanceVendor | null;
    financeClient?: FinanceClient | null;
  },
) => {
  const plain = profile.get({ plain: true }) as StaffProfile & {
    user?: User | null;
    financeVendor?: FinanceVendor | null;
    financeClient?: FinanceClient | null;
  };
  const user = plain.user;
  const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  const profilePhotoUrl = user?.profilePhotoUrl ?? null;

  return {
    userId: plain.userId,
    staffType: plain.staffType,
    livesInAccom: plain.livesInAccom,
    active: plain.active,
    financeVendorId: plain.financeVendorId ?? null,
    financeClientId: plain.financeClientId ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    userName: fullName.length > 0 ? fullName : null,
    userEmail: user?.email ?? null,
    userStatus: user?.status ?? null,
    profilePhotoUrl,
    financeVendorName: plain.financeVendor?.name ?? null,
    financeClientName: plain.financeClient?.name ?? null,
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

const extractForeignKeyValue = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return extractForeignKeyValue((value as { id?: unknown }).id);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid identifier');
  }
  return parsed;
};

const ensureVendorExists = async (id: number | null): Promise<void> => {
  if (!id) {
    return;
  }
  const exists = await FinanceVendor.count({ where: { id } });
  if (!exists) {
    throw new Error(`Finance vendor ${id} does not exist`);
  }
};

const ensureClientExists = async (id: number | null): Promise<void> => {
  if (!id) {
    return;
  }
  const exists = await FinanceClient.count({ where: { id } });
  if (!exists) {
    throw new Error(`Finance client ${id} does not exist`);
  }
};

export const listStaffProfiles = async (req: Request, res: Response): Promise<void> => {
  try {
    const profiles = await StaffProfile.findAll({
      include: STAFF_PROFILE_INCLUDE,
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
      include: STAFF_PROFILE_INCLUDE,
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

    let financeVendorId: number | null;
    let financeClientId: number | null;

    try {
      financeVendorId = extractForeignKeyValue(req.body.financeVendorId ?? req.body.financeVendor?.id);
      financeClientId = extractForeignKeyValue(req.body.financeClientId ?? req.body.financeClient?.id);
    } catch {
      res.status(400).json([{ message: 'Finance identifiers must be positive integers or null.' }]);
      return;
    }

    try {
      await ensureVendorExists(financeVendorId);
      await ensureClientExists(financeClientId);
    } catch (validationError) {
      const message = validationError instanceof Error ? validationError.message : 'Invalid finance linkage';
      res.status(400).json([{ message }]);
      return;
    }

    const profile = await StaffProfile.create({
      userId,
      staffType,
      livesInAccom,
      active: active ?? true,
      financeVendorId,
      financeClientId,
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

    const hasFinanceVendor =
      Object.prototype.hasOwnProperty.call(req.body, 'financeVendorId') ||
      Object.prototype.hasOwnProperty.call(req.body, 'financeVendor');
    const hasFinanceClient =
      Object.prototype.hasOwnProperty.call(req.body, 'financeClientId') ||
      Object.prototype.hasOwnProperty.call(req.body, 'financeClient');

    try {
      if (hasFinanceVendor) {
        const financeVendorId = extractForeignKeyValue(req.body.financeVendorId ?? req.body.financeVendor?.id);
        updates.financeVendorId = financeVendorId;
        await ensureVendorExists(financeVendorId);
      }
      if (hasFinanceClient) {
        const financeClientId = extractForeignKeyValue(req.body.financeClientId ?? req.body.financeClient?.id);
        updates.financeClientId = financeClientId;
        await ensureClientExists(financeClientId);
      }
    } catch {
      res.status(400).json([{ message: 'Finance identifiers must be positive integers that reference valid records.' }]);
      return;
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
      include: STAFF_PROFILE_INCLUDE,
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
      include: STAFF_PROFILE_INCLUDE,
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
