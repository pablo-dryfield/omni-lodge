import { decideStaffFreeEntry, qualifiesForStaffFreeThreshold, staffFreeUnlimitedBenefit, type StaffFreePolicy } from '../staffFreeEntryPolicy';

const policy: StaffFreePolicy = { allowance: 2, busyThreshold: 20, minimumPricePercent: 50, productTypeNames: ['Pub Crawl'] };
const base = { staffType: 'volunteer', unlimitedBenefit: null, active: true, onShift: false, used: 0, checkedIn: 19, policy };

describe('Staff lifetime free-crawl policy', () => {
  it('uses the allowance below 20 qualifying customers, without a monthly reset', () => {
    expect(decideStaffFreeEntry(base).benefit).toBe('allowance');
    expect(decideStaffFreeEntry({ ...base, used: 1 }).benefit).toBe('allowance');
    expect(decideStaffFreeEntry({ ...base, used: 2 })).toMatchObject({ allowed: false, canOverride: true });
  });
  it.each([20, 21, 100])('exempts at %i qualifying customers even after the allowance is exhausted', checkedIn => {
    expect(decideStaffFreeEntry({ ...base, used: 2, checkedIn })).toMatchObject({ allowed: true, benefit: 'busy_night' });
  });
  it('applies the edited general allowance without resetting existing usage', () => {
    expect(decideStaffFreeEntry({ ...base, used: 2, policy: { ...policy, allowance: 3 } }).benefit).toBe('allowance');
    expect(decideStaffFreeEntry({ ...base, policy: { ...policy, allowance: 0 } }).allowed).toBe(false);
  });
  it.each(['admin', 'administrator', 'owner', 'manager', 'assistant-manager'])('allows unlimited %s visits but never inactive or on-duty admission', role => {
    const unlimitedBenefit = staffFreeUnlimitedBenefit(role, 'volunteer');
    expect(unlimitedBenefit).toBe(role === 'assistant-manager' ? 'assistant_manager' : 'management');
    expect(decideStaffFreeEntry({ ...base, unlimitedBenefit, used: 99, checkedIn: 0, policy: { ...policy, allowance: 0 } })).toMatchObject({ allowed: true, benefit: unlimitedBenefit });
    expect(decideStaffFreeEntry({ ...base, unlimitedBenefit, onShift: true })).toMatchObject({ allowed: false, canOverride: false });
    expect(decideStaffFreeEntry({ ...base, unlimitedBenefit, active: false })).toMatchObject({ allowed: false, canOverride: false });
  });
  it('recognizes management staff profiles only with an assigned role, without granting unlimited entries to unrelated roles', () => {
    expect(staffFreeUnlimitedBenefit('guide', 'assistant_manager')).toBe('assistant_manager');
    expect(staffFreeUnlimitedBenefit('guide', 'manager')).toBe('management');
    expect(staffFreeUnlimitedBenefit(' Administrator ', 'guide')).toBe('management');
    expect(staffFreeUnlimitedBenefit('', 'manager')).toBeNull();
    expect(staffFreeUnlimitedBenefit('guide', 'volunteer')).toBeNull();
    expect(staffFreeUnlimitedBenefit('food-tour-manager', 'guide')).toBeNull();
  });
  it('does not allow an override to grant an ineligible or inactive person a staff benefit', () => {
    expect(decideStaffFreeEntry({ ...base, staffType: 'guide' })).toMatchObject({ allowed: false, canOverride: false });
    expect(decideStaffFreeEntry({ ...base, active: false })).toMatchObject({ allowed: false, canOverride: false });
    expect(decideStaffFreeEntry({ ...base, staffType: 'long_term' }).allowed).toBe(true);
  });
});

describe('Minimum base ticket price', () => {
  it('includes exactly half price and excludes one cent below it', () => {
    expect(qualifiesForStaffFreeThreshold(55, 1, 110, 50)).toBe(true);
    expect(qualifiesForStaffFreeThreshold(54.99, 1, 110, 50)).toBe(false);
    expect(qualifiesForStaffFreeThreshold(110, 2, 110, 50)).toBe(true);
    expect(qualifiesForStaffFreeThreshold(109.99, 2, 110, 50)).toBe(false);
  });
  it('supports configurable percentages and never counts free tickets', () => {
    expect(qualifiesForStaffFreeThreshold(60, 1, 100, 60)).toBe(true);
    expect(qualifiesForStaffFreeThreshold(0, 1, 110, 0)).toBe(false);
  });
  it('flags unknown base amounts or reference prices', () => {
    expect(qualifiesForStaffFreeThreshold(null, 1, 110, 50)).toBeNull();
    expect(qualifiesForStaffFreeThreshold(110, 1, null, 50)).toBeNull();
    expect(qualifiesForStaffFreeThreshold(110, 1, 0, 50)).toBeNull();
  });
});
