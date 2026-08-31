import sequelize from '../config/database.js';
import AuditLog from '../models/AuditLog.js';
import HomeQuickActionConfig, {
  type HomeQuickActionAudienceMode,
} from '../models/HomeQuickActionConfig.js';
import HomeQuickActionTarget, {
  type HomeQuickActionTargetEffect,
} from '../models/HomeQuickActionTarget.js';
import StaffProfile from '../models/StaffProfile.js';
import {
  isHomeQuickActionVisible,
  type HomeQuickActionAudienceIdentity,
} from './homeQuickActionAudience.js';

export { isHomeQuickActionVisible } from './homeQuickActionAudience.js';

export const HOME_QUICK_ACTION_AUDIENCE_MODES = ['all', 'targeted'] as const;
export const HOME_QUICK_ACTION_STAFF_PROFILE_TYPES = [
  'volunteer',
  'long_term',
  'assistant_manager',
  'manager',
  'guide',
] as const;

export type HomeQuickActionStaffProfileType = typeof HOME_QUICK_ACTION_STAFF_PROFILE_TYPES[number];

export type HomeQuickActionConfigDto = {
  actionId: string;
  enabled: boolean;
  audienceMode: HomeQuickActionAudienceMode;
  allowUserIds: number[];
  denyUserIds: number[];
  userTypeIds: number[];
  shiftRoleIds: number[];
  staffProfileTypes: HomeQuickActionStaffProfileType[];
};

export type HomeQuickActionIdentity = HomeQuickActionAudienceIdentity & {
  staffProfileType: HomeQuickActionStaffProfileType | null;
};

export type SaveHomeQuickActionConfig = HomeQuickActionConfigDto;

const uniquePositiveIntegers = (values: number[]): number[] =>
  Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort((a, b) => a - b);

const uniqueStaffProfileTypes = (
  values: HomeQuickActionStaffProfileType[],
): HomeQuickActionStaffProfileType[] => {
  const allowed = new Set<string>(HOME_QUICK_ACTION_STAFF_PROFILE_TYPES);
  return Array.from(new Set(values.filter((value) => allowed.has(value)))).sort();
};

const asSortedUnique = (values: Array<number | null | undefined>): number[] =>
  uniquePositiveIntegers(values.filter((value): value is number => typeof value === 'number'));

export const serializeHomeQuickActionConfig = (
  config: HomeQuickActionConfig,
): HomeQuickActionConfigDto => {
  const targets = config.targets ?? [];
  return {
    actionId: config.actionKey,
    enabled: config.enabled,
    audienceMode: config.audienceMode,
    allowUserIds: asSortedUnique(
      targets.filter((target) => target.effect === 'allow').map((target) => target.userId),
    ),
    denyUserIds: asSortedUnique(
      targets.filter((target) => target.effect === 'deny').map((target) => target.userId),
    ),
    userTypeIds: asSortedUnique(
      targets.filter((target) => target.effect === 'allow').map((target) => target.userTypeId),
    ),
    shiftRoleIds: asSortedUnique(
      targets.filter((target) => target.effect === 'allow').map((target) => target.shiftRoleId),
    ),
    staffProfileTypes: uniqueStaffProfileTypes(
      targets
        .filter((target) => target.effect === 'allow')
        .map((target) => target.staffProfileType)
        .filter((value): value is HomeQuickActionStaffProfileType =>
          HOME_QUICK_ACTION_STAFF_PROFILE_TYPES.includes(value as HomeQuickActionStaffProfileType),
        ),
    ),
  };
};

export const listHomeQuickActionConfigs = async (): Promise<HomeQuickActionConfig[]> =>
  HomeQuickActionConfig.findAll({
    include: [{ model: HomeQuickActionTarget, as: 'targets', required: false }],
    order: [['sortOrder', 'ASC'], ['actionKey', 'ASC']],
  });

export const resolveHomeQuickActionVisibility = async (identity: {
  userId: number;
  userTypeId: number | null;
  shiftRoleIds?: number[];
}): Promise<Record<string, boolean>> => {
  const configs = await listHomeQuickActionConfigs();
  if (configs.length === 0) {
    return {};
  }

  const needsStaffProfile = configs.some((config) =>
    (config.targets ?? []).some((target) => Boolean(target.staffProfileType)),
  );
  const staffProfile = needsStaffProfile
    ? await StaffProfile.findOne({
        where: { userId: identity.userId, active: true },
        attributes: ['staffType'],
      })
    : null;
  const staffProfileType = staffProfile?.staffType;
  const resolvedIdentity: HomeQuickActionIdentity = {
    userId: identity.userId,
    userTypeId: identity.userTypeId,
    shiftRoleIds: uniquePositiveIntegers(identity.shiftRoleIds ?? []),
    staffProfileType: HOME_QUICK_ACTION_STAFF_PROFILE_TYPES.includes(
      staffProfileType as HomeQuickActionStaffProfileType,
    )
      ? staffProfileType as HomeQuickActionStaffProfileType
      : null,
  };

  return Object.fromEntries(
    configs.map((config) => [
      config.actionKey,
      isHomeQuickActionVisible({
        enabled: config.enabled,
        audienceMode: config.audienceMode,
        targets: (config.targets ?? []).map((target) => ({
          effect: target.effect,
          userId: target.userId,
          userTypeId: target.userTypeId,
          shiftRoleId: target.shiftRoleId,
          staffProfileType: target.staffProfileType,
        })),
      }, resolvedIdentity),
    ]),
  );
};

const createTargets = (
  config: SaveHomeQuickActionConfig,
): Array<{
  actionKey: string;
  effect: HomeQuickActionTargetEffect;
  userId: number | null;
  userTypeId: number | null;
  shiftRoleId: number | null;
  staffProfileType: HomeQuickActionStaffProfileType | null;
}> => [
  ...uniquePositiveIntegers(config.allowUserIds).map((userId) => ({
    actionKey: config.actionId,
    effect: 'allow' as const,
    userId,
    userTypeId: null,
    shiftRoleId: null,
    staffProfileType: null,
  })),
  ...uniquePositiveIntegers(config.denyUserIds).map((userId) => ({
    actionKey: config.actionId,
    effect: 'deny' as const,
    userId,
    userTypeId: null,
    shiftRoleId: null,
    staffProfileType: null,
  })),
  ...uniquePositiveIntegers(config.userTypeIds).map((userTypeId) => ({
    actionKey: config.actionId,
    effect: 'allow' as const,
    userId: null,
    userTypeId,
    shiftRoleId: null,
    staffProfileType: null,
  })),
  ...uniquePositiveIntegers(config.shiftRoleIds).map((shiftRoleId) => ({
    actionKey: config.actionId,
    effect: 'allow' as const,
    userId: null,
    userTypeId: null,
    shiftRoleId,
    staffProfileType: null,
  })),
  ...uniqueStaffProfileTypes(config.staffProfileTypes).map((staffProfileType) => ({
    actionKey: config.actionId,
    effect: 'allow' as const,
    userId: null,
    userTypeId: null,
    shiftRoleId: null,
    staffProfileType,
  })),
];

export const replaceHomeQuickActionConfigs = async (
  configs: SaveHomeQuickActionConfig[],
  actorId: number,
): Promise<HomeQuickActionConfigDto[]> => {
  const uniqueConfigs = Array.from(new Map(configs.map((config) => [config.actionId, config])).values());

  await sequelize.transaction(async (transaction) => {
    for (const config of uniqueConfigs) {
      const existing = await HomeQuickActionConfig.findByPk(config.actionId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing) {
        existing.targets = await HomeQuickActionTarget.findAll({
          where: { actionKey: config.actionId },
          transaction,
          order: [['id', 'ASC']],
        });
      }
      const before = existing ? serializeHomeQuickActionConfig(existing) : null;
      const [record] = await HomeQuickActionConfig.upsert(
        {
          actionKey: config.actionId,
          enabled: config.enabled,
          audienceMode: config.audienceMode,
          sortOrder: 0,
          createdBy: existing?.createdBy ?? actorId,
          updatedBy: actorId,
        },
        { transaction, returning: true },
      );

      await HomeQuickActionTarget.destroy({ where: { actionKey: config.actionId }, transaction });
      const targets = createTargets(config);
      if (targets.length > 0) {
        await HomeQuickActionTarget.bulkCreate(targets, { transaction });
      }

      await AuditLog.create(
        {
          actorId,
          action: existing ? 'home_quick_action.update' : 'home_quick_action.create',
          entity: 'home_quick_action_config',
          entityId: record.actionKey,
          metaJson: { before, after: config },
        },
        { transaction },
      );
    }
  });

  const saved = await listHomeQuickActionConfigs();
  const savedKeys = new Set(uniqueConfigs.map((config) => config.actionId));
  return saved.filter((config) => savedKeys.has(config.actionKey)).map(serializeHomeQuickActionConfig);
};
