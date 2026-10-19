import { evaluateStayAssessment, type StayAssessment, type StayReview } from '../volunteerStayAssessmentPolicy.js';
const scope = { startDate: '2026-09-16', endDate: '2026-10-13' };
const review = (actorId: number, vote: 'up' | 'down'): StayReview => ({ ...scope, actorId, vote, feedback: 'Observed work', updatedAt: '2026-10-14T10:00:00Z' });

describe('volunteer management star voting', () => {
  it.each([
    [['up'], true], [['down'], false], [['up', 'down'], true], [['down', 'down'], false],
    [['up', 'up'], true], [['up', 'up', 'down'], true], [['down', 'down', 'up'], false],
    [['down', 'down', 'down'], false], [['up', 'up', 'down', 'down'], true],
    [['up', 'down', 'down', 'down'], false],
  ] as Array<[Array<'up' | 'down'>, boolean]>)('evaluates %j as earned=%s', (votes, earned) => {
    const ids = votes.map((_, i) => i + 1);
    const saved: StayAssessment = { reviews: Object.fromEntries(votes.map((vote, i) => [String(i + 1), review(i + 1, vote)])) };
    expect(evaluateStayAssessment(ids, saved, scope)).toMatchObject({ earned, pendingCount: 0 });
  });
  it('waits for every required manager even when a majority already voted up', () => {
    expect(evaluateStayAssessment([1, 2, 3], { reviews: { '1': review(1, 'up'), '2': review(2, 'up') } }, scope))
      .toMatchObject({ earned: false, pendingCount: 1, upCount: 2, downCount: 0 });
  });
  it('deduplicates people and excludes waivers without treating them as up votes', () => {
    const saved = { reviews: { '1': review(1, 'down') }, reviewerWaivers: { '2': { ...scope, actorId: 99, reason: 'Departed', updatedAt: '2026-10-14' } } };
    expect(evaluateStayAssessment([1, 1, 2], saved, scope)).toMatchObject({ earned: false, downCount: 1, upCount: 0, waivedCount: 1 });
  });
  it('requires an explicit no-vote assessment, which cannot override an active electorate', () => {
    expect(evaluateStayAssessment([], null, scope)).toMatchObject({ earned: false, needsFallback: true });
    expect(evaluateStayAssessment([], { fallback: review(99, 'up') }, scope)).toMatchObject({ earned: true });
    expect(evaluateStayAssessment([1], { fallback: review(99, 'up') }, scope)).toMatchObject({ earned: false, pendingCount: 1, fallback: null });
  });
  it('does not reuse another stay window or another actor’s vote', () => {
    expect(evaluateStayAssessment([1], { reviews: { '1': { ...review(1, 'up'), endDate: '2026-11-01' } } }, scope).pendingCount).toBe(1);
    expect(evaluateStayAssessment([1], { reviews: { '1': review(2, 'up') } }, scope).pendingCount).toBe(1);
  });
});
