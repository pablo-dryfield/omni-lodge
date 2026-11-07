import type { StaffFreeCounterMetrics } from '../api/staffFreeEntries';
import { getLiveStaffFreeQualification, type StaffFreeLiveAttendance } from './staffFreeLiveQualification';

/** Preview against the same unsaved attendance and prices used for staff admission. */
export function getLiveStaffFreeMetricCount(
  staffFreeCount: number,
  metrics: StaffFreeCounterMetrics | undefined,
  attendance: StaffFreeLiveAttendance,
): number {
  if (!metrics) return staffFreeCount;
  const qualification = getLiveStaffFreeQualification(attendance, metrics.normalPrices, metrics.minimumPricePercent);
  const qualifyingCustomers = qualification?.count ?? metrics.qualifyingCustomers;
  return qualifyingCustomers >= metrics.busyThreshold ? 0 : staffFreeCount;
}
