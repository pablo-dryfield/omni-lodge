import type Stripe from 'stripe';
import type { PartnerPayment } from '../../../models/Partner.js';
import { hashToken } from '../partnerPolicy.js';
import { reconcileRuleTransfers } from '../partnerRuleTransfers.js';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let rows: any[], stripe: any, serial: number;
const group = (pi = 'pi_1') => `partner_rule_41_${hashToken(pi).slice(0, 32)}`;
const payment = (pi = 'pi_1', amount = 100, refunded = 0) => ({ payment: { paymentIntentId: pi, amount } as PartnerPayment,
  charge: { id: `ch_${pi}`, amount: amount * 100, amount_refunded: refunded * 100, payment_method_details: { type: 'card' } } as Stripe.Charge });
const options = () => ({ canCreate: true, mode: 'test', destination: jest.fn().mockResolvedValue('acct_partner') });
const transfer = (amount: number, pi = 'pi_1') => ({ id: `tr_${++serial}`, amount, amount_reversed: 0, currency: 'pln', destination: 'acct_partner',
  source_transaction: `ch_${pi}`, transfer_group: group(pi), metadata: { partnerBookingId: '41', partnerPaymentIntentId: pi, originalCharge: `ch_${pi}` } });
beforeEach(() => {
  rows = []; serial = 0;
  stripe = { transfers: {
    list: jest.fn(async ({ transfer_group }: any) => ({ data: clone(rows.filter(row => row.transfer_group === transfer_group)), has_more: false })),
    create: jest.fn(async (input: any) => { const result = { ...input, id: `tr_${++serial}`, amount_reversed: 0, source_transaction: input.source_transaction ?? null }; rows.push(clone(result)); return clone(result); }),
    createReversal: jest.fn(async (id: string, { amount }: { amount: number }) => {
      const row = rows.find(value => value.id === id); row.amount_reversed += amount;
      if (row.amount_reversed > row.amount) throw new Error('Invalid reversal');
      return { id: 'trr_test', amount, transfer: id };
    }),
  } };
});
it('recovers a completed transfer after SQL rollback instead of creating another', async () => {
  expect((await reconcileRuleTransfers(stripe, 41, [payment()], 2000, options())).transferredMinor).toBe(2000);
  expect((await reconcileRuleTransfers(stripe, 41, [payment()], 2000, options())).transferredMinor).toBe(2000);
  expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  expect(stripe.transfers.create.mock.calls[0][0]).toMatchObject({ amount: 2000, source_transaction: 'ch_pi_1' });
});
it('adjusts a fixed commission after a same-price change without requiring another customer payment', async () => {
  await reconcileRuleTransfers(stripe, 41, [payment()], 2000, options());
  await reconcileRuleTransfers(stripe, 41, [payment()], 3000, options());
  expect(stripe.transfers.create.mock.calls.map((call: any) => call[0].amount)).toEqual([2000, 1000]);
  expect(stripe.transfers.create.mock.calls[0][1].idempotencyKey).not.toBe(stripe.transfers.create.mock.calls[1][1].idempotencyKey);
  expect((await reconcileRuleTransfers(stripe, 41, [payment()], 3000, options())).transferredMinor).toBe(3000);
  expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
});
it('keeps an already-paid fixed fee after a monetary refund', async () => {
  await reconcileRuleTransfers(stripe, 41, [payment()], 2000, options());
  expect((await reconcileRuleTransfers(stripe, 41, [payment('pi_1', 100, 90)], 2000, options())).transferredMinor).toBe(2000);
  expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
});
it('can fund a promised fixed fee from the platform balance after a refund', async () => {
  await reconcileRuleTransfers(stripe, 41, [payment('pi_1', 100, 100)], 2000, options());
  expect(stripe.transfers.create.mock.calls[0][0]).not.toHaveProperty('source_transaction');
  expect(rows[0]).toMatchObject({ amount: 2000, metadata: { originalCharge: 'ch_pi_1' } });
});
it('recovers reversals after SQL rollback and can later restore a higher earned amount', async () => {
  rows.push(transfer(2000));
  await reconcileRuleTransfers(stripe, 41, [payment()], 1000, options());
  await reconcileRuleTransfers(stripe, 41, [payment()], 1000, options());
  expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
  await reconcileRuleTransfers(stripe, 41, [payment()], 2000, options());
  expect(stripe.transfers.create.mock.calls[0][0].amount).toBe(1000);
  expect((await reconcileRuleTransfers(stripe, 41, [payment()], 2000, options())).transferredMinor).toBe(2000);
});
it('uses platform balance when lifetime source-linked transfers would exceed the charge', async () => {
  rows.push({ ...transfer(10000), amount_reversed: 10000 });
  await reconcileRuleTransfers(stripe, 41, [payment()], 1000, options());
  expect(stripe.transfers.create.mock.calls[0][0]).not.toHaveProperty('source_transaction');
});
it('removes all commission for cancellation and still reverses while new transfers are disabled', async () => {
  rows.push(transfer(2000), transfer(1000));
  const result = await reconcileRuleTransfers(stripe, 41, [payment()], 0, { ...options(), canCreate: false });
  expect(result.transferredMinor).toBe(0); expect(result.reversedMinor).toBe(3000);
  expect(stripe.transfers.create).not.toHaveBeenCalled();
});
it('reports observed money after a failed adjustment without inventing a successful payout', async () => {
  stripe.transfers.create.mockRejectedValue(new Error('Unavailable platform balance'));
  await expect(reconcileRuleTransfers(stripe, 41, [payment()], 2000, options())).rejects.toThrow();
  expect((await reconcileRuleTransfers(stripe, 41, [payment()], 0, { ...options(), readOnly: true })).transferredMinor).toBe(0);
});
it('rejects unrelated provider allocations and fees above the original verified receipts', async () => {
  rows.push({ ...transfer(2000), metadata: { partnerBookingId: 'another-company' } });
  await expect(reconcileRuleTransfers(stripe, 41, [payment()], 2000, options())).rejects.toThrow(/does not match/);
  rows = [];
  await expect(reconcileRuleTransfers(stripe, 41, [payment()], 10001, options())).rejects.toThrow(/exceeds/);
  expect(stripe.transfers.create).not.toHaveBeenCalled();
});
it('allocates across independently verified original and amendment payments', async () => {
  const result = await reconcileRuleTransfers(stripe, 41, [payment('pi_1', 100), payment('pi_2', 60)], 12000, options());
  expect(result.transferredMinor).toBe(12000);
  expect(stripe.transfers.create.mock.calls.map((call: any) => [call[0].amount, call[0].source_transaction])).toEqual([[10000, 'ch_pi_1'], [2000, 'ch_pi_2']]);
});
