import type { StaffFreeChanges, StaffFreeCounterEntry, StaffFreeOverview } from '../api/staffFreeEntries';

export type StaffFreeDraft = {
  additions: Array<{ userId: number; name: string; override: boolean; overrideReason: string }>;
  removals: Array<{ entryId: number; name: string; reason: string }>;
};
export const emptyStaffFreeDraft = (): StaffFreeDraft => ({ additions: [], removals: [] });
export const hasStaffFreeDraft = (draft: StaffFreeDraft): boolean => Boolean(draft.additions.length || draft.removals.length);

/** Local drafts are untrusted and may predate this feature. Never restore malformed rows. */
export function restoreStaffFreeDraft(value: unknown): StaffFreeDraft {
  const result = emptyStaffFreeDraft();
  if (!value || typeof value !== 'object') return result;
  const raw = value as Partial<StaffFreeDraft>;
  for (const item of Array.isArray(raw.additions) ? raw.additions : []) {
    if (!item || !Number.isSafeInteger(item.userId) || item.userId <= 0 || typeof item.name !== 'string' || typeof item.overrideReason !== 'string') continue;
    if (!result.additions.some(row => row.userId === item.userId)) result.additions.push({ userId: item.userId, name: item.name, override: item.override === true, overrideReason: item.overrideReason.slice(0, 2000) });
  }
  for (const item of Array.isArray(raw.removals) ? raw.removals : []) {
    if (!item || !Number.isSafeInteger(item.entryId) || item.entryId <= 0 || typeof item.name !== 'string' || typeof item.reason !== 'string' || !item.reason.trim()) continue;
    if (!result.removals.some(row => row.entryId === item.entryId)) result.removals.push({ entryId: item.entryId, name: item.name, reason: item.reason.slice(0, 2000) });
  }
  return result;
}

export function staffFreeDraftCount(entries: readonly Pick<StaffFreeCounterEntry, 'id' | 'userId'>[], draft: StaffFreeDraft): number {
  const ids = new Set(entries.filter(entry => !draft.removals.some(row => row.entryId === entry.id)).map(entry => entry.userId));
  draft.additions.forEach(entry => ids.add(entry.userId));
  return ids.size;
}

export function staffFreeDraftChanges(draft: StaffFreeDraft): StaffFreeChanges {
  return {
    additions: draft.additions.map(row => ({ userId: row.userId, ...(row.override ? { overrideReason: row.overrideReason.trim() } : {}) })),
    removals: draft.removals.map(row => ({ entryId: row.entryId, reason: row.reason.trim() })),
  };
}

export function staffFreeDraftError(draft: StaffFreeDraft, data: StaffFreeOverview | null, attendanceReady: boolean): string | null {
  if (!hasStaffFreeDraft(draft)) return null;
  if (!data) return 'Loading Staff Free details before saving.';
  if (!data.enabled) return 'Staff Free is unavailable for this counter.';
  if (draft.additions.length && !attendanceReady) return 'Waiting for reservation attendance before saving Staff Free entries.';
  for (const row of draft.additions) {
    if (data.entries.some(entry => entry.userId === row.userId && !draft.removals.some(removal => removal.entryId === entry.id))) continue;
    const person = data.staff.find(item => item.id === row.userId);
    if (!person) return `${row.name}: this staff member is no longer eligible. Remove this entry to continue.`;
    if (!person.decision.allowed && (!person.decision.canOverride || !row.override || !row.overrideReason.trim())) {
      return `${row.name}: ${person.decision.canOverride ? 'An override and reason are required.' : person.decision.message}`;
    }
  }
  return null;
}
