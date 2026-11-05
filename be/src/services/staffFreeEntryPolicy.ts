export type StaffFreeUnlimitedBenefit = 'assistant_manager' | 'management';
export type StaffFreeBenefit = 'allowance' | 'busy_night' | StaffFreeUnlimitedBenefit | 'override' | 'paid';
export type StaffFreePolicy = { allowance: number; busyThreshold: number; minimumPricePercent: number; productTypeNames: string[]; paidTicketPrice?: number };
export type StaffFreeDecision = { allowed: boolean; benefit: StaffFreeBenefit | null; message: string; canOverride: boolean };

export function staffFreeUnlimitedBenefit(roleSlug: string, staffType: string | null): StaffFreeUnlimitedBenefit | null {
  const role = roleSlug.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!role) return null;
  if (['admin', 'administrator', 'owner', 'manager'].includes(role) || staffType === 'manager') return 'management';
  if (role === 'assistantmanager' || staffType === 'assistant_manager') return 'assistant_manager';
  return null;
}

/** Initial admission decision. A separate audited reconciliation returns allowances when attendance grows. */
export function decideStaffFreeEntry(input: {
  staffType: string | null; unlimitedBenefit: StaffFreeUnlimitedBenefit | null; active: boolean; onShift: boolean;
  used: number; checkedIn: number; policy: StaffFreePolicy;
}): StaffFreeDecision {
  const deny = (message: string, canOverride = false): StaffFreeDecision => ({ allowed: false, benefit: null, message, canOverride });
  if (!input.active) return deny('This staff member is inactive.');
  if (input.onShift) return deny('Assigned to work this pub crawl. Staff free entry is only for off-duty attendance.');
  if (input.unlimitedBenefit) return { allowed: true, benefit: input.unlimitedBenefit, message: 'Unlimited off-duty staff entry.', canOverride: false };
  if (!['volunteer', 'long_term'].includes(input.staffType ?? '')) return deny('Free staff entry is available to volunteers, long-term staff, Assistant Managers, Managers, Owners and Administrators.');
  if (input.checkedIn >= input.policy.busyThreshold) return { allowed: true, benefit: 'busy_night', message: `${input.checkedIn} qualifying customers already checked in. This visit will not use the allowance.`, canOverride: false };
  if (input.used < input.policy.allowance) return { allowed: true, benefit: 'allowance', message: `Uses one free crawl. ${Math.max(0, input.policy.allowance - input.used - 1)} will remain.`, canOverride: false };
  return deny(`Lifetime allowance used. Wait until ${input.policy.busyThreshold} qualifying customers are checked in, or record an override with a reason.`, true);
}

export function qualifiesForStaffFreeThreshold(baseTotal: number | null, partySize: number, normalPrice: number | null, minimumPercent: number): boolean | null {
  if (baseTotal === null || normalPrice === null || normalPrice <= 0 || partySize <= 0 || !Number.isFinite(baseTotal)) return null;
  if (baseTotal <= 0) return false;
  // Compare at currency minor-unit precision. Exactly half price qualifies.
  return Math.round(baseTotal * 100) * 100 >= Math.round(normalPrice * 100) * minimumPercent * partySize;
}

export function staffFreeBenefitLabel(benefit: StaffFreeBenefit): string {
  return { allowance: 'Allowance used', busy_night: 'Attendance exemption', assistant_manager: 'Unlimited Assistant Manager entry', management: 'Unlimited management entry', override: 'Manager override', paid: 'Staff Ticket' }[benefit];
}
