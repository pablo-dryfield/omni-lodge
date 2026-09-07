import { assertCleaningRevision, readCleaningPhotoSources, shiftsOverlap } from '../cleaningSubmissionRulesService.js';

const config = () => ({ cleaningPhotoApprovalEnabled: true,
  evidenceRules: [{ key: 'room', label: 'Bedroom', type: 'image', required: true, minItems: 2, multiple: true }],
  shiftEvidenceSources: [{ key: 'cleaning', evidenceRuleKey: 'room', shiftTypeIds: [7] }] });
describe('cleaning photo rule and time validation', () => {
  it('requires explicit opt-in and expands every required minimum photo slot', () => {
    expect(readCleaningPhotoSources({})).toEqual([]);
    expect(readCleaningPhotoSources(config())[0].slots).toEqual([
      { key: 'cleaning-1', label: 'Bedroom (1 of 2)', ruleKey: 'room' },
      { key: 'cleaning-2', label: 'Bedroom (2 of 2)', ruleKey: 'room' },
    ]);
  });
  it.each(['requireSocialMediaPlan', 'completeOnSocialMediaPublish', 'volunteerAttendance'])('rejects incompatible %s completion rules', (key) => {
    expect(() => readCleaningPhotoSources({ ...config(), [key]: key === 'volunteerAttendance' ? {} : true })).toThrow('cannot be combined');
  });
  it('rejects extra required links or images without assigned-shift sources', () => {
    for (const type of ['link', 'image']) expect(() => readCleaningPhotoSources({ ...config(), evidenceRules: [...config().evidenceRules,
      { key: 'extra', type, required: true }] })).toThrow('Every required rule');
  });
  it('rejects missing/invalid sources and unreasonable slot counts', () => {
    expect(() => readCleaningPhotoSources({ cleaningPhotoApprovalEnabled: true })).toThrow();
    const tooMany = config(); tooMany.evidenceRules[0].minItems = 25;
    expect(() => readCleaningPhotoSources(tooMany)).toThrow();
    const badId = config(); badId.shiftEvidenceSources[0].shiftTypeIds = [0];
    expect(() => readCleaningPhotoSources(badId)).toThrow();
  });
  it('handles overnight overlap and excludes merely touching or missing time windows', () => {
    const night = { date: '2026-09-07', timeStart: '22:00', timeEnd: '02:00' };
    expect(shiftsOverlap(night, { date: '2026-09-08', timeStart: '01:00', timeEnd: '03:00' })).toBe(true);
    expect(shiftsOverlap(night, { date: '2026-09-08', timeStart: '02:00', timeEnd: '03:00' })).toBe(false);
    expect(shiftsOverlap(night, { date: '2026-09-07', timeStart: '21:00', timeEnd: null })).toBe(false);
  });
  it('validates exact integer optimistic revisions including multipart strings', () => {
    expect(() => assertCleaningRevision('3', 3)).not.toThrow();
    for (const bad of [undefined, '3.0', '-1', 0, 1.5, true]) expect(() => assertCleaningRevision(bad, 3)).toThrow();
    expect(() => assertCleaningRevision(2, 3)).toThrow('changed');
  });
});
