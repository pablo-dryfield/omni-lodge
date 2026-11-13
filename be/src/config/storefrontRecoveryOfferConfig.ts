export const RECOVERY_OFFER_CONFIG_KEY = 'STOREFRONT_RECOVERY_OFFER_RULES';

export type RecoveryOfferRule = {
  id: string;
  name: string;
  enabled: boolean;
  minGuests: number;
  promotionId: number;
};

export type RecoveryOfferRules = {
  guestCountMode: 'largest_group' | 'total_guests';
  applyAutomatically: boolean;
  rules: RecoveryOfferRule[];
};

export const DEFAULT_RECOVERY_OFFER_RULES: RecoveryOfferRules = {
  guestCountMode: 'largest_group', applyAutomatically: true, rules: [],
};

export const parseRecoveryOfferRules = (value: unknown): RecoveryOfferRules => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Recovery offers must be an object.');
  const input = parsed as Record<string, unknown>;
  if (!['largest_group', 'total_guests'].includes(String(input.guestCountMode))) throw new Error('Choose how recovery offers count guests.');
  if (typeof input.applyAutomatically !== 'boolean') throw new Error('Choose whether the recovery link applies the coupon automatically.');
  if (!Array.isArray(input.rules) || input.rules.length > 25) throw new Error('Provide up to 25 recovery offer rules.');
  const ids = new Set<string>();
  const rules = input.rules.map((raw): RecoveryOfferRule => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each recovery rule must be an object.');
    const rule = raw as Record<string, unknown>;
    if (typeof rule.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(rule.id) || ids.has(rule.id)) throw new Error('Recovery rule IDs must be unique letters, numbers, hyphens or underscores.');
    ids.add(rule.id);
    if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 120) throw new Error('Each recovery rule needs a name of up to 120 characters.');
    if (typeof rule.enabled !== 'boolean') throw new Error('Each rule must be enabled or disabled.');
    if (!Number.isSafeInteger(rule.minGuests) || Number(rule.minGuests) < 1 || Number(rule.minGuests) > 10000) throw new Error('Minimum guests must be a whole number between 1 and 10,000.');
    if (!Number.isSafeInteger(rule.promotionId) || Number(rule.promotionId) <= 0) throw new Error('Select a coupon for every recovery rule.');
    return { id: rule.id, name: rule.name.trim(), enabled: rule.enabled, minGuests: Number(rule.minGuests), promotionId: Number(rule.promotionId) };
  });
  return { guestCountMode: input.guestCountMode as RecoveryOfferRules['guestCountMode'], applyAutomatically: input.applyAutomatically, rules };
};
