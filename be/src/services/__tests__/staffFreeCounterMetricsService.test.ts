jest.mock('../staffFreeEntryService.js', () => ({ getStaffFreePolicy: jest.fn() }));
jest.mock('../staffFreeQualificationService.js', () => ({ getStaffFreeQualification: jest.fn() }));

import type Counter from '../../models/Counter';
import { getStaffFreePolicy } from '../staffFreeEntryService';
import { getStaffFreeQualification } from '../staffFreeQualificationService';
import { getStaffFreeCounterMetrics } from '../staffFreeCounterMetricsService';

const counter = { id: 986, productId: 28, date: '2026-11-07', notes: null } as Counter;
const policy = { allowance: 2, busyThreshold: 20, minimumPricePercent: 50, productTypeNames: ['Main Product'], paidTicketPrice: 30 };
const qualification = { count: 19, totalCustomers: 30, free: 3, belowMinimum: 5, unpriced: 3, normalPrices: { PLN: 110 }, minimumPercent: 50 };

beforeEach(() => {
  jest.clearAllMocks();
  (getStaffFreePolicy as jest.Mock).mockResolvedValue(policy);
  (getStaffFreeQualification as jest.Mock).mockResolvedValue(qualification);
});

it.each([19, 20, 21])('uses qualifying customers, not the total headcount, at %i customers', async count => {
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ ...qualification, count });
  expect(await getStaffFreeCounterMetrics(counter, 3)).toEqual({
    qualifyingCustomers: count, busyThreshold: 20, minimumPricePercent: 50, normalPrices: { PLN: 110 },
    includedCount: count < 20 ? 3 : 0, excludedCount: count < 20 ? 0 : 3,
  });
  expect(getStaffFreeQualification).toHaveBeenCalledWith(counter, 50, undefined);
});

it('recalculates when later customers reach the threshold, and when attendance is corrected', async () => {
  expect((await getStaffFreeCounterMetrics(counter, 3)).includedCount).toBe(3);
  (getStaffFreeQualification as jest.Mock).mockResolvedValue({ ...qualification, count: 20 });
  expect((await getStaffFreeCounterMetrics(counter, 3)).includedCount).toBe(0);
  (getStaffFreeQualification as jest.Mock).mockResolvedValue(qualification);
  expect((await getStaffFreeCounterMetrics(counter, 3)).includedCount).toBe(3);
});

it('uses Control Panel policy and allows a shared policy for a multi-counter report', async () => {
  const custom = { ...policy, busyThreshold: 25, minimumPricePercent: 75 };
  expect(await getStaffFreeCounterMetrics(counter, 2, custom)).toMatchObject({ busyThreshold: 25, minimumPricePercent: 75, includedCount: 2 });
  expect(getStaffFreePolicy).not.toHaveBeenCalled();
  expect(getStaffFreeQualification).toHaveBeenCalledWith(counter, 75, undefined);
});

it('returns qualification context for an empty staff card without creating or cancelling visits', async () => {
  expect(await getStaffFreeCounterMetrics(counter, 0)).toMatchObject({ includedCount: 0, excludedCount: 0, normalPrices: { PLN: 110 } });
});
