import type Stripe from 'stripe';
import type { PartnerPayment } from '../../models/Partner.js';
import HttpError from '../../errors/HttpError.js';
import { hashToken } from './partnerPolicy.js';

type Payment = { payment: PartnerPayment; charge: Stripe.Charge };
const objectId = (value: string | { id: string } | null): string | null => typeof value === 'string' ? value : value?.id ?? null;
const net = (rows: Stripe.Transfer[]) => rows.reduce((sum, row) => sum + row.amount - row.amount_reversed, 0);

/** Provider history is the money-movement ledger. If SQL rolls back after a
 * successful transfer or reversal, the next attempt recovers its actual state.
 * Keys use immutable Stripe identities and verified provider state, never SQL IDs.
 */
export async function reconcileRuleTransfers(
  stripe: Stripe, bookingId: number, payments: Payment[], targetMinor: number,
  options: { canCreate: boolean; mode: string; destination: () => Promise<string>; readOnly?: boolean },
) {
  const states: Array<Payment & { group: string; transfers: Stripe.Transfer[]; target: number; capacity: number }> = [];
  const validate = (transfer: Stripe.Transfer, part: Payment) => {
    if (transfer.currency !== 'pln' || !Number.isSafeInteger(transfer.amount) || transfer.amount < 0
      || !Number.isSafeInteger(transfer.amount_reversed) || transfer.amount_reversed < 0 || transfer.amount_reversed > transfer.amount
      || transfer.metadata?.partnerBookingId !== String(bookingId) || transfer.metadata?.partnerPaymentIntentId !== part.payment.paymentIntentId
      || transfer.metadata?.originalCharge !== part.charge.id
      || (transfer.source_transaction && objectId(transfer.source_transaction) !== part.charge.id)) {
      throw new HttpError(409, 'A Stripe commission transfer does not match the verified partner payment.');
    }
  };
  for (const part of payments) {
    if (!Number.isSafeInteger(part.charge.amount) || part.charge.amount !== Math.round(Number(part.payment.amount) * 100)
      || !Number.isSafeInteger(part.charge.amount_refunded) || part.charge.amount_refunded < 0 || part.charge.amount_refunded > part.charge.amount) {
      throw new HttpError(409, 'Stripe charge amounts do not match the verified partner receipt.');
    }
    const group = `partner_rule_${bookingId}_${hashToken(part.payment.paymentIntentId!).slice(0, 32)}`;
    const transfers: Stripe.Transfer[] = [];
    let cursor: string | undefined;
    do {
      const page = await stripe.transfers.list({ transfer_group: group, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      for (const transfer of page.data) { validate(transfer, part); transfers.push(transfer); }
      const next = page.has_more ? page.data.at(-1)?.id : undefined;
      if (page.has_more && (!next || next === cursor)) throw new HttpError(409, 'Stripe commission history could not be paginated safely.');
      cursor = next;
    } while (cursor);
    states.push({ ...part, group, transfers, target: 0, capacity: part.charge.amount });
  }
  const snapshot = () => {
    const transfers = states.flatMap(state => state.transfers.map(transfer => ({ id: transfer.id, paymentIntentId: state.payment.paymentIntentId,
      amount: transfer.amount, reversedAmount: transfer.amount_reversed })));
    return { transferredMinor: states.reduce((sum, state) => sum + net(state.transfers), 0),
      reversedMinor: transfers.reduce((sum, transfer) => sum + transfer.reversedAmount, 0), transferId: transfers.at(0)?.id ?? null, transfers };
  };
  if (options.readOnly) return snapshot();
  if (!Number.isSafeInteger(targetMinor) || targetMinor < 0 || targetMinor > states.reduce((sum, row) => sum + row.capacity, 0)) {
    throw new HttpError(409, 'Commission exceeds the verified original customer payments.');
  }
  // Preserve existing allocations where possible, rather than moving commission
  // unnecessarily between the original payment and amendment payments.
  let remaining = targetMinor;
  for (const state of states) { state.target = Math.min(net(state.transfers), state.capacity, remaining); remaining -= state.target; }
  for (const state of states) { const extra = Math.min(remaining, state.capacity - state.target); state.target += extra; remaining -= extra; }
  let destination: string | undefined;
  for (const state of states) {
    let excess = Math.max(0, net(state.transfers) - state.target);
    for (const transfer of state.transfers) {
      const amount = Math.min(excess, transfer.amount - transfer.amount_reversed);
      if (amount <= 0) continue;
      const cumulative = transfer.amount_reversed + amount;
      const reversal = await stripe.transfers.createReversal(transfer.id, { amount, metadata: { partnerBookingId: String(bookingId), cumulativeTarget: String(cumulative) } },
        { idempotencyKey: `partner-rule-reversal-${transfer.id}-${cumulative}` });
      if (reversal.amount !== amount || objectId(reversal.transfer) !== transfer.id) throw new HttpError(409, 'Stripe did not confirm the expected commission reversal.');
      transfer.amount_reversed = cumulative; excess -= amount;
    }
    const extra = state.target - net(state.transfers);
    if (extra > 0 && options.canCreate) {
      destination ??= await options.destination();
      if (state.transfers.some(transfer => objectId(transfer.destination) !== destination)) throw new HttpError(409, 'The partner Stripe destination changed. Operations must reconcile the existing allocations.');
      const fingerprint = hashToken(JSON.stringify({ bookingId, payment: state.payment.paymentIntentId, target: state.target,
        previous: state.transfers.map(transfer => [transfer.id, transfer.amount_reversed]).sort() }));
      // Stripe caps the sum of source-linked transfers at the charge amount.
      // A later catch-up after reversal can instead use the returned platform
      // balance. It remains linked in metadata and subject to the same receipt cap.
      const sourceLinked = state.charge.amount_refunded === 0 && state.charge.payment_method_details?.type === 'card'
        && state.transfers.reduce((sum, transfer) => sum + (transfer.source_transaction ? transfer.amount : 0), 0) + extra <= state.charge.amount;
      const transfer = await stripe.transfers.create({ amount: extra, currency: 'pln', destination,
        ...(sourceLinked ? { source_transaction: state.charge.id } : {}), transfer_group: state.group,
        metadata: { partnerBookingId: String(bookingId), partnerPaymentIntentId: state.payment.paymentIntentId!, originalCharge: state.charge.id } },
      { idempotencyKey: `partner-rule-transfer-${options.mode}-${fingerprint}` });
      validate(transfer, state);
      if (transfer.amount !== extra || objectId(transfer.destination) !== destination) throw new HttpError(409, 'Stripe did not confirm the expected partner commission.');
      state.transfers.push(transfer);
    }
  }
  return snapshot();
}
