export type HomeQuickActionAudienceMode = 'all' | 'targeted';
export type HomeQuickActionAudienceEffect = 'allow' | 'deny';

export type HomeQuickActionAudienceIdentity = {
  userId: number;
  userTypeId: number | null;
  shiftRoleIds: number[];
  staffProfileType: string | null;
};

export type HomeQuickActionAudienceTarget = {
  effect: HomeQuickActionAudienceEffect;
  userId: number | null;
  userTypeId: number | null;
  shiftRoleId: number | null;
  staffProfileType: string | null;
};

export type HomeQuickActionAudienceRule = {
  enabled: boolean;
  audienceMode: HomeQuickActionAudienceMode;
  targets?: HomeQuickActionAudienceTarget[];
};

const targetMatchesIdentity = (
  target: HomeQuickActionAudienceTarget,
  identity: HomeQuickActionAudienceIdentity,
): boolean => {
  if (target.userId != null) {
    return target.userId === identity.userId;
  }
  if (target.userTypeId != null) {
    return target.userTypeId === identity.userTypeId;
  }
  if (target.shiftRoleId != null) {
    return identity.shiftRoleIds.includes(target.shiftRoleId);
  }
  if (target.staffProfileType) {
    return target.staffProfileType === identity.staffProfileType;
  }
  return false;
};

export const isHomeQuickActionVisible = (
  rule: HomeQuickActionAudienceRule,
  identity: HomeQuickActionAudienceIdentity,
): boolean => {
  if (!rule.enabled) {
    return false;
  }

  const targets = rule.targets ?? [];
  if (targets.some((target) => target.effect === 'deny' && targetMatchesIdentity(target, identity))) {
    return false;
  }

  if (rule.audienceMode === 'all') {
    return true;
  }

  return targets.some(
    (target) => target.effect === 'allow' && targetMatchesIdentity(target, identity),
  );
};
