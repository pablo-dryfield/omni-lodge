import { emptyStaffFreeDraft, hasStaffFreeDraft, restoreStaffFreeDraft, staffFreeDraftChanges, staffFreeDraftCount, staffFreeDraftError, type StaffFreeDraft } from './staffFreeDraft';
import type { StaffFreeOverview } from '../api/staffFreeEntries';

const draft: StaffFreeDraft = { additions: [{ userId: 7, name: 'Volunteer', override: true, overrideReason: ' Farewell ' }], removals: [{ entryId: 3, name: 'Previous', reason: ' Wrong person ' }] };
it('round-trips selections, removals and unfinished reasons through the local reservation draft JSON', () => {
  expect(restoreStaffFreeDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  expect(hasStaffFreeDraft(draft)).toBe(true);
  expect(restoreStaffFreeDraft(undefined)).toEqual(emptyStaffFreeDraft());
  const unfinished = { ...draft, additions: [{ ...draft.additions[0], overrideReason: '' }] };
  expect(restoreStaffFreeDraft(unfinished)).toEqual(unfinished);
});
it('rejects malformed local entries and deduplicates restored selections', () => {
  expect(restoreStaffFreeDraft({ additions: [null, {}, draft.additions[0], draft.additions[0]], removals: [{ entryId: 3, name: 'Previous', reason: '' }] })).toEqual({ additions: draft.additions, removals: [] });
});
it('counts the draft without double-counting a retried successful admission', () => {
  expect(staffFreeDraftCount([{ id: 3, userId: 8 }], draft)).toBe(1);
  expect(staffFreeDraftCount([{ id: 3, userId: 8 }, { id: 4, userId: 7 }], draft)).toBe(1);
});
it('sends IDs and recorded reasons without trusting cached names or allowance decisions', () => {
  expect(staffFreeDraftChanges(draft)).toEqual({ additions: [{ userId: 7, overrideReason: 'Farewell' }], removals: [{ entryId: 3, reason: 'Wrong person' }] });
  expect(staffFreeDraftChanges({ ...draft, additions: [{ ...draft.additions[0], override: false }] }).additions).toEqual([{ userId: 7 }]);
});
it('blocks saving unavailable staff and incomplete overrides without losing the draft', () => {
  const data: StaffFreeOverview = { enabled: true, policy: { allowance: 2, busyThreshold: 20, minimumPricePercent: 50 }, checkedIn: 19, entries: [], staff: [{ id: 7, name: 'Volunteer', staffType: 'volunteer', unlimited: false, used: 2, remaining: 0, totalVisits: 2, alreadyCheckedIn: false, onShift: false, decision: { allowed: false, benefit: null, canOverride: true, message: 'Exhausted' } }] };
  expect(staffFreeDraftError(draft, null, true)).toContain('Loading');
  expect(staffFreeDraftError(draft, data, false)).toContain('Waiting');
  expect(staffFreeDraftError({ ...draft, additions: [{ ...draft.additions[0], overrideReason: '' }] }, data, true)).toContain('override and reason');
  expect(staffFreeDraftError(draft, data, true)).toBeNull();
  expect(staffFreeDraftError(draft, { ...data, staff: [] }, true)).toContain('no longer eligible');
});
