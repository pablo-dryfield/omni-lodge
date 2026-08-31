import type { Response } from 'express';
import { ForeignKeyConstraintError, Op, ValidationError } from 'sequelize';
import ShiftRole from '../models/ShiftRole.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import UserShiftRole from '../models/UserShiftRole.js';
import UserType from '../models/UserType.js';
import {
  HOME_QUICK_ACTION_AUDIENCE_MODES,
  HOME_QUICK_ACTION_STAFF_PROFILE_TYPES,
  listHomeQuickActionConfigs,
  replaceHomeQuickActionConfigs,
  serializeHomeQuickActionConfig,
  type HomeQuickActionConfigDto,
  type HomeQuickActionStaffProfileType,
} from '../services/homeQuickActionService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest';

class InvalidQuickActionConfigurationError extends Error {}

const parsePositiveIntegerArray = (value: unknown, fieldName: string): number[] => {
  if (!Array.isArray(value)) {
    throw new InvalidQuickActionConfigurationError(`${fieldName} must be an array`);
  }
  const parsed = value.map((entry) => Number(entry));
  if (parsed.some((entry) => !Number.isInteger(entry) || entry <= 0)) {
    throw new InvalidQuickActionConfigurationError(`${fieldName} must contain positive integer IDs`);
  }
  return Array.from(new Set(parsed)).slice(0, 500);
};

const parseStaffProfileTypes = (value: unknown): HomeQuickActionStaffProfileType[] => {
  if (!Array.isArray(value)) {
    throw new InvalidQuickActionConfigurationError('staffProfileTypes must be an array');
  }
  const allowed = new Set<string>(HOME_QUICK_ACTION_STAFF_PROFILE_TYPES);
  const parsed = value.map((entry) => String(entry).trim().toLowerCase());
  if (parsed.some((entry) => !allowed.has(entry))) {
    throw new InvalidQuickActionConfigurationError('staffProfileTypes contains an unsupported value');
  }
  return Array.from(new Set(parsed)) as HomeQuickActionStaffProfileType[];
};

const parseConfiguration = (value: unknown): HomeQuickActionConfigDto => {
  if (!value || typeof value !== 'object') {
    throw new InvalidQuickActionConfigurationError('Each shortcut configuration must be an object');
  }
  const payload = value as Record<string, unknown>;
  const actionId = typeof payload.actionId === 'string' ? payload.actionId.trim() : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(actionId) || actionId.length > 120) {
    throw new InvalidQuickActionConfigurationError('actionId must be a valid shortcut key');
  }
  if (typeof payload.enabled !== 'boolean') {
    throw new InvalidQuickActionConfigurationError('enabled must be true or false');
  }
  const audienceMode = typeof payload.audienceMode === 'string' ? payload.audienceMode : '';
  if (!HOME_QUICK_ACTION_AUDIENCE_MODES.includes(audienceMode as 'all' | 'targeted')) {
    throw new InvalidQuickActionConfigurationError('audienceMode must be all or targeted');
  }

  const parsed: HomeQuickActionConfigDto = {
    actionId,
    enabled: payload.enabled,
    audienceMode: audienceMode as HomeQuickActionConfigDto['audienceMode'],
    allowUserIds: parsePositiveIntegerArray(payload.allowUserIds ?? [], 'allowUserIds'),
    denyUserIds: parsePositiveIntegerArray(payload.denyUserIds ?? [], 'denyUserIds'),
    userTypeIds: parsePositiveIntegerArray(payload.userTypeIds ?? [], 'userTypeIds'),
    shiftRoleIds: parsePositiveIntegerArray(payload.shiftRoleIds ?? [], 'shiftRoleIds'),
    staffProfileTypes: parseStaffProfileTypes(payload.staffProfileTypes ?? []),
  };

  const denied = new Set(parsed.denyUserIds);
  if (parsed.allowUserIds.some((userId) => denied.has(userId))) {
    throw new InvalidQuickActionConfigurationError(
      'A user cannot be included and excluded from the same shortcut',
    );
  }
  const allowTargetCount = parsed.allowUserIds.length
    + parsed.userTypeIds.length
    + parsed.shiftRoleIds.length
    + parsed.staffProfileTypes.length;
  if (parsed.enabled && parsed.audienceMode === 'targeted' && allowTargetCount === 0) {
    throw new InvalidQuickActionConfigurationError(
      'A targeted shortcut needs at least one included audience',
    );
  }
  return parsed;
};

export const getHomeQuickActionBootstrap = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const [configs, users, userTypes, shiftRoles] = await Promise.all([
      listHomeQuickActionConfigs(),
      User.findAll({
        where: { status: true, approved: true },
        attributes: ['id', 'firstName', 'lastName', 'email', 'userTypeId'],
        order: [['firstName', 'ASC'], ['lastName', 'ASC'], ['id', 'ASC']],
      }),
      UserType.findAll({
        attributes: ['id', 'name', 'slug', 'status'],
        order: [['name', 'ASC'], ['id', 'ASC']],
      }),
      ShiftRole.findAll({
        attributes: ['id', 'name', 'slug'],
        order: [['name', 'ASC'], ['id', 'ASC']],
      }),
    ]);

    const userIds = users.map((user) => user.id);
    const [roleAssignments, staffProfiles] = userIds.length > 0
      ? await Promise.all([
          UserShiftRole.findAll({
            where: { userId: { [Op.in]: userIds } },
            attributes: ['userId', 'shiftRoleId'],
          }),
          StaffProfile.findAll({
            where: { userId: { [Op.in]: userIds }, active: true },
            attributes: ['userId', 'staffType'],
          }),
        ])
      : [[], []];

    const rolesByUser = new Map<number, number[]>();
    roleAssignments.forEach((assignment) => {
      const current = rolesByUser.get(assignment.userId) ?? [];
      current.push(assignment.shiftRoleId);
      rolesByUser.set(assignment.userId, current);
    });
    const staffTypeByUser = new Map(
      staffProfiles.map((profile) => [profile.userId, profile.staffType]),
    );

    res.json({
      configurations: configs.map(serializeHomeQuickActionConfig),
      options: {
        users: users.map((user) => ({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          userTypeId: user.userTypeId ?? null,
          shiftRoleIds: Array.from(new Set(rolesByUser.get(user.id) ?? [])).sort((a, b) => a - b),
          staffProfileType: staffTypeByUser.get(user.id) ?? null,
        })),
        userTypes: userTypes.map((userType) => ({
          id: userType.id,
          name: userType.name,
          slug: userType.slug,
          active: userType.status,
        })),
        shiftRoles: shiftRoles.map((shiftRole) => ({
          id: shiftRole.id,
          name: shiftRole.name,
          slug: shiftRole.slug,
        })),
        staffProfileTypes: HOME_QUICK_ACTION_STAFF_PROFILE_TYPES.map((value) => ({
          value,
          label: value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
        })),
      },
    });
  } catch (error) {
    console.error('Failed to load home quick action configuration', error);
    res.status(500).json({ message: 'Failed to load homepage shortcut configuration' });
  }
};

export const updateHomeQuickActionConfiguration = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = req.authContext?.id;
    if (!actorId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const values = (req.body as { configurations?: unknown } | undefined)?.configurations;
    if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
      throw new InvalidQuickActionConfigurationError(
        'configurations must contain between 1 and 100 shortcuts',
      );
    }
    const configurations = values.map(parseConfiguration);
    const saved = await replaceHomeQuickActionConfigs(configurations, actorId);
    res.json({ configurations: saved });
  } catch (error) {
    if (
      error instanceof InvalidQuickActionConfigurationError
      || error instanceof ForeignKeyConstraintError
      || error instanceof ValidationError
    ) {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('Failed to update home quick action configuration', error);
    res.status(500).json({ message: 'Failed to update homepage shortcut configuration' });
  }
};
