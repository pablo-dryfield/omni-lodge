const START = '-- STAFF-ENTRIES START --';
const END = '-- STAFF-ENTRIES END --';
export type StaffEntryNote = { userId: number; name: string; label: string; reason: string | null; amount?: number; currency?: string };

/** Replace only our generated block; keep operational notes and payment snapshots intact. */
export function withStaffEntryNotes(notes: string | null, entries: StaffEntryNote[]): string | null {
  const manual = (notes ?? '').replace(/-- STAFF-ENTRIES START --[\s\S]*?-- STAFF-ENTRIES END --/g, '').trim();
  if (!entries.length) return manual || null;
  return [manual, `${START}\n${JSON.stringify(entries)}\n${END}`].filter(Boolean).join('\n\n');
}
