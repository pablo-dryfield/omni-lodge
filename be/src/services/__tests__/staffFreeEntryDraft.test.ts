import { parseStaffFreeChanges } from '../staffFreeEntryDraft';

const draft = { additions: [{ userId: 7, overrideReason: ' Farewell ' }], removals: [{ entryId: 3, reason: ' Wrong person ' }] };
it.each(['admin', 'administrator', 'owner', 'manager', 'assistant-manager'])('allows %s to save named staff changes', role => {
  expect(parseStaffFreeChanges(draft, role)).toEqual({ additions: [{ userId: 7, overrideReason: 'Farewell' }], removals: [{ entryId: 3, reason: 'Wrong person' }] });
});
it.each(['guide', 'food-tour-owner', '', null])('rejects staff changes from unauthorized roles: %s', role => {
  expect(() => parseStaffFreeChanges(draft, role)).toThrow('Only management');
});
it('keeps ordinary counter saves available without staff changes', () => {
  expect(parseStaffFreeChanges(undefined, 'guide')).toBeUndefined();
  expect(parseStaffFreeChanges({ additions: [], removals: [] }, 'guide')).toBeUndefined();
});
it.each([
  null, [], { additions: {}, removals: [] }, { additions: [{ userId: -1 }], removals: [] },
  { additions: [{ userId: 7 }, { userId: 7 }], removals: [] },
  { additions: [], removals: [{ entryId: 3, reason: '' }] },
  { additions: [{ userId: 7, overrideReason: 'x'.repeat(2001) }], removals: [] },
])('rejects malformed drafts before changing counter attendance: %j', value => {
  expect(() => parseStaffFreeChanges(value, 'manager')).toThrow();
});
