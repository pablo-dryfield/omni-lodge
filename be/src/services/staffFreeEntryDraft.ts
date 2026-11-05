import HttpError from '../errors/HttpError.js';

export type StaffFreeChanges = {
  additions: Array<{ userId: number; overrideReason?: string }>;
  removals: Array<{ entryId: number; reason: string }>;
};

/** Validate and authorize before the counter endpoint performs any writes. */
export function parseStaffFreeChanges(raw: unknown, roleSlug: string | null | undefined): StaffFreeChanges | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Invalid Staff Free changes.');
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.additions) || !Array.isArray(value.removals) || value.additions.length + value.removals.length > 1000) {
    throw new HttpError(400, 'Invalid Staff Free changes.');
  }
  const role = String(roleSlug ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
  if ((value.additions.length || value.removals.length) && !['admin', 'administrator', 'owner', 'manager', 'mgr', 'assistantmanager', 'assistmanager'].includes(role)) {
    throw new HttpError(403, 'Only management can record Staff Free entries.');
  }
  const row = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid Staff Free entry.');
    return input as Record<string, unknown>;
  };
  const id = (input: unknown): number => {
    if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) throw new HttpError(400, 'Invalid Staff Free ID.');
    return input;
  };
  const reason = (input: unknown, required: boolean): string | undefined => {
    if (input === undefined && !required) return undefined;
    if (typeof input !== 'string' || input.length > 2000 || (required && !input.trim())) throw new HttpError(400, 'Provide a Staff Free reason (up to 2,000 characters).');
    return input.trim() || undefined;
  };
  const additions = value.additions.map(input => { const item = row(input); return { userId: id(item.userId), overrideReason: reason(item.overrideReason, false) }; });
  const removals = value.removals.map(input => { const item = row(input); return { entryId: id(item.entryId), reason: reason(item.reason, true)! }; });
  if (new Set(additions.map(item => item.userId)).size !== additions.length || new Set(removals.map(item => item.entryId)).size !== removals.length) {
    throw new HttpError(400, 'Staff Free changes contain duplicate entries.');
  }
  return additions.length || removals.length ? { additions, removals } : undefined;
}
