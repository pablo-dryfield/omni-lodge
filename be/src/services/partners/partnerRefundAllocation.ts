/** Allocate integer minor units without creating rounding cents or exceeding a line's capacity. */
export function allocateRefundMinor(amount: number, capacities: number[]): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0 || capacities.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid refund allocation.');
  const total = capacities.reduce((sum, value) => sum + value, 0);
  if (amount > total) throw new Error('Refund exceeds the operational payment.');
  if (!amount) return capacities.map(() => 0);
  const result = capacities.map(value => Math.floor(amount * value / total));
  let remainder = amount - result.reduce((sum, value) => sum + value, 0);
  const priority = capacities.map((value, index) => ({ index, fraction: amount * value / total - result[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of priority) {
    if (remainder && result[index] < capacities[index]) { result[index]++; remainder--; }
  }
  if (remainder) throw new Error('Unable to allocate refund.');
  return result;
}
