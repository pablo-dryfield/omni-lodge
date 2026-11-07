import type { Transaction } from 'sequelize';
import type Counter from '../models/Counter.js';
import { getStaffFreePolicy } from './staffFreeEntryService.js';
import type { StaffFreePolicy } from './staffFreeEntryPolicy.js';
import { getStaffFreeQualification } from './staffFreeQualificationService.js';

/** Staff visits remain in the admission ledger even when they do not count as customers. */
export async function getStaffFreeCounterMetrics(
  counter: Counter,
  staffFreeCount: number,
  policy?: StaffFreePolicy,
  transaction?: Transaction,
) {
  const effectivePolicy = policy ?? await getStaffFreePolicy();
  const qualification = await getStaffFreeQualification(counter, effectivePolicy.minimumPricePercent, transaction);
  const excluded = qualification.count >= effectivePolicy.busyThreshold;
  return {
    qualifyingCustomers: qualification.count,
    busyThreshold: effectivePolicy.busyThreshold,
    minimumPricePercent: effectivePolicy.minimumPricePercent,
    normalPrices: qualification.normalPrices,
    includedCount: excluded ? 0 : staffFreeCount,
    excludedCount: excluded ? staffFreeCount : 0,
  };
}
