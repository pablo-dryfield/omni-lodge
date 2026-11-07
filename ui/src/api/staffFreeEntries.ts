import axiosInstance from '../utils/axiosInstance';

export type StaffFreeBenefit = 'allowance' | 'busy_night' | 'assistant_manager' | 'management' | 'override' | 'paid';
export type StaffFreeChanges = { additions: Array<{ userId: number; overrideReason?: string }>; removals: Array<{ entryId: number; reason: string }> };
export type StaffFreeCounterEntry = { id: number; userId: number; name: string; benefit: StaffFreeBenefit; label: string; checkedInBefore: number; overrideReason: string | null; createdAt: string };
export type StaffFreeCounterMetrics = {
  qualifyingCustomers: number; busyThreshold: number; minimumPricePercent: number;
  normalPrices: Record<string, number>; includedCount: number; excludedCount: number;
};
export type StaffFreePerson = {
  id: number; name: string; staffType: string; unlimited: boolean; used: number; remaining: number | null;
  totalVisits: number; alreadyCheckedIn: boolean; onShift: boolean;
  decision: { allowed: boolean; benefit: StaffFreeBenefit | null; message: string; canOverride: boolean };
};
export type StaffFreeOverview = {
  enabled: boolean; checkedIn: number;
  policy: { allowance: number; busyThreshold: number; minimumPricePercent: number; paidTicketPrice?: number };
  qualification?: { count: number; totalCustomers: number; free: number; belowMinimum: number; unpriced: number; normalPrices: Record<string, number>; minimumPercent: number };
  staff: StaffFreePerson[]; entries: StaffFreeCounterEntry[];
};
export type StaffFreeHistoryEntry = {
  id: number; counterId: number; date: string; benefit: StaffFreeBenefit; label: string; checkedInBefore: number;
  recordedBy: string; recordedAt: string; overrideReason: string | null;
  paidAmount?: number | null; payment?: { currency: string; methodName: string; status: 'received' | 'awaiting' } | null;
  cancelledAt: string | null; cancelledBy: string | null; cancellationReason: string | null;
  allowanceReturnedAt: string | null; allowanceReturnedAtCount: number | null;
};
export type StaffFreeAccount = {
  visible: boolean; eligible: boolean; unlimited: boolean; allowance: number; busyThreshold: number;
  used: number; remaining: number | null; totalVisits: number; paidVisits?: number; pendingPaidVisits?: number; history: StaffFreeHistoryEntry[];
};
export const getMyStaffFreeAccount = async (signal?: AbortSignal) =>
  (await axiosInstance.get<StaffFreeAccount>('/session/staff-free-entries', { signal })).data;
export const getStaffFreeEntries = async (counterId: number) => (await axiosInstance.get<StaffFreeOverview>(`/counters/${counterId}/staff-free-entries`)).data;
export const getStaffFreeHistory = async (counterId: number, userId: number) => (await axiosInstance.get<StaffFreeHistoryEntry[]>(`/counters/${counterId}/staff-free-entries/history/${userId}`)).data;
export const checkInStaffFree = async (counterId: number, userId: number, expectedBenefit: StaffFreeBenefit, overrideReason?: string) =>
  (await axiosInstance.post<StaffFreeOverview>(`/counters/${counterId}/staff-free-entries`, { userId, expectedBenefit, overrideReason })).data;
export const cancelStaffFree = async (counterId: number, entryId: number, reason: string) =>
  (await axiosInstance.post<StaffFreeOverview>(`/counters/${counterId}/staff-free-entries/${entryId}/cancel`, { reason })).data;
