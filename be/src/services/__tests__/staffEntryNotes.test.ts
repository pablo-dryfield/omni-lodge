import { withStaffEntryNotes } from '../staffEntryNotes';
it('replaces staff details without duplicating them or deleting other notes and snapshots', () => {
  const original = 'Manager note\n-- CASH-SNAPSHOT START --\n{}\n-- CASH-SNAPSHOT END --';
  const entries = [{ userId: 7, name: 'Sam', label: 'Allowance used', reason: null }];
  const once = withStaffEntryNotes(original, entries)!;
  expect(withStaffEntryNotes(once, entries)).toBe(once);
  expect(withStaffEntryNotes(once, [])).toBe(original);
  const changed = withStaffEntryNotes(once, [{ ...entries[0], label: 'Attendance exemption' }]);
  expect(changed).not.toContain('Allowance used');
  expect(changed).toContain('Attendance exemption');
});
