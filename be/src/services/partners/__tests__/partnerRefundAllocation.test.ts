import { allocateRefundMinor } from '../partnerRefundAllocation';

it('allocates every cent without assigning any to already fully refunded lines', () => {
  expect(allocateRefundMinor(2, [1, 1, 1, 0])).toEqual([1, 1, 0, 0]);
  expect(allocateRefundMinor(100, [0, 99, 1, 0])).toEqual([0, 99, 1, 0]);
});
it('rejects an excess refund and fractional minor units', () => {
  expect(() => allocateRefundMinor(101, [100])).toThrow(/exceeds/);
  expect(() => allocateRefundMinor(0.1, [100])).toThrow(/Invalid/);
});
it('preserves the requested total and line capacities across varied amounts', () => {
  for (const capacities of [[1, 3, 7], [12000, 13000, 0], [0], [999, 1, 1, 1]]) {
    const total = capacities.reduce((sum, value) => sum + value, 0);
    for (const amount of [0, Math.floor(total / 3), Math.floor(total / 2), total]) {
      const result = allocateRefundMinor(amount, capacities);
      expect(result.reduce((sum, value) => sum + value, 0)).toBe(amount);
      result.forEach((value, index) => expect(value).toBeLessThanOrEqual(capacities[index]));
    }
  }
});
