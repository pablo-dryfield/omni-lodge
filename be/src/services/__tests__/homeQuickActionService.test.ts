import {
  isHomeQuickActionVisible,
  type HomeQuickActionAudienceIdentity,
} from '../homeQuickActionAudience';

const identity: HomeQuickActionAudienceIdentity = {
  userId: 28,
  userTypeId: 3,
  shiftRoleIds: [2, 7],
  staffProfileType: 'long_term',
};

const target = (overrides: Record<string, unknown>) => ({
  effect: 'allow' as const,
  userId: null,
  userTypeId: null,
  shiftRoleId: null,
  staffProfileType: null,
  ...overrides,
});

describe('home quick action audience matching', () => {
  it('keeps an enabled all-audience action visible by default', () => {
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'all', targets: [] }, identity)).toBe(true);
  });

  it('matches each supported audience dimension', () => {
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'targeted', targets: [target({ userId: 28 })] }, identity)).toBe(true);
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'targeted', targets: [target({ userTypeId: 3 })] }, identity)).toBe(true);
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'targeted', targets: [target({ shiftRoleId: 7 })] }, identity)).toBe(true);
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'targeted', targets: [target({ staffProfileType: 'long_term' })] }, identity)).toBe(true);
  });

  it('uses OR matching and hides targeted actions with no matching allow target', () => {
    expect(isHomeQuickActionVisible({
      enabled: true,
      audienceMode: 'targeted',
      targets: [target({ userTypeId: 99 }), target({ shiftRoleId: 7 })],
    }, identity)).toBe(true);
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'targeted', targets: [] }, identity)).toBe(false);
  });

  it('lets an explicit deny override all and targeted audiences', () => {
    const deny = target({ effect: 'deny', userId: 28 });
    expect(isHomeQuickActionVisible({ enabled: true, audienceMode: 'all', targets: [deny] }, identity)).toBe(false);
    expect(isHomeQuickActionVisible({
      enabled: true,
      audienceMode: 'targeted',
      targets: [target({ userTypeId: 3 }), deny],
    }, identity)).toBe(false);
  });

  it('always hides disabled actions', () => {
    expect(isHomeQuickActionVisible({ enabled: false, audienceMode: 'all', targets: [] }, identity)).toBe(false);
  });
});
