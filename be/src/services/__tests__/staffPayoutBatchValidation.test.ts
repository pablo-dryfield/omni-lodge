import HttpError from '../../errors/HttpError.js';
import {
  assertStaffPayoutDirectionDetails,
  assertStaffPayoutSettlementIntentDirections,
  assertUniqueStaffAffiliatePayoutClaims,
  deriveStaffPayoutReimbursementAmount,
  parseStrictStaffPayoutDate,
  validateStaffPayoutFinanceSelections,
  type StaffPayoutReimbursementSourceRecord,
} from '../staffPayoutBatchValidation.js';
import type { CompensationSettlementIntentPayload } from '../compensationSettlementIntentService.js';

const expectHttpError = (
  callback: () => unknown,
  status: number,
  message: string | RegExp,
): void => {
  try {
    callback();
    throw new Error('Expected callback to throw an HttpError.');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status });
    if (typeof message === 'string') {
      expect((error as Error).message).toBe(message);
    } else {
      expect((error as Error).message).toMatch(message);
    }
  }
};

const buildReimbursementSource = (
  overrides: Partial<StaffPayoutReimbursementSourceRecord> = {},
): StaffPayoutReimbursementSourceRecord => ({
  id: 71,
  kind: 'expense',
  status: 'awaiting_reimbursement',
  date: '2026-07-15',
  currency: 'PLN',
  amountMinor: 2_000,
  baseAmountMinor: 2_000,
  counterpartyType: 'vendor',
  counterpartyId: 8,
  meta: { paidByUserId: 24 },
  ...overrides,
});

const deriveReimbursement = (
  overrides: Partial<Parameters<typeof deriveStaffPayoutReimbursementAmount>[0]> = {},
): number => deriveStaffPayoutReimbursementAmount({
  requestedTransactionIds: [71],
  requestedAmountMinor: 2_000,
  sourceRows: [buildReimbursementSource()],
  staffUserId: 24,
  staffVendorId: 8,
  rangeStart: '2026-07-01',
  rangeEnd: '2026-07-31',
  baseCurrency: 'PLN',
  ...overrides,
});

describe('staff payout batch validation', () => {
  describe('payout date', () => {
    it('accepts only exact, real YYYY-MM-DD calendar dates', () => {
      expect(parseStrictStaffPayoutDate('2026-08-29')).toBe('2026-08-29');
      expect(parseStrictStaffPayoutDate('2024-02-29')).toBe('2024-02-29');
    });

    it.each([
      undefined,
      null,
      '',
      '2026-8-29',
      '2026-08-29T10:00:00.000Z',
    ])('rejects a missing or non-canonical payout date (%p)', (value) => {
      expectHttpError(
        () => parseStrictStaffPayoutDate(value),
        400,
        'date must use YYYY-MM-DD format.',
      );
    });

    it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10'])(
      'rejects the impossible calendar date %s',
      (value) => {
        expectHttpError(
          () => parseStrictStaffPayoutDate(value),
          400,
          'date must be a valid calendar date.',
        );
      },
    );
  });

  describe('direction-specific details', () => {
    it('rejects reimbursements in receivable batches', () => {
      expectHttpError(
        () => assertStaffPayoutDirectionDetails({
          direction: 'receivable',
          hasReimbursement: true,
          hasAffiliatePayout: false,
        }),
        400,
        'Reimbursements can only be included in payable staff batches.',
      );
    });

    it('rejects affiliate payouts in receivable batches and permits payable details', () => {
      expectHttpError(
        () => assertStaffPayoutDirectionDetails({
          direction: 'receivable',
          hasReimbursement: false,
          hasAffiliatePayout: true,
        }),
        400,
        'Affiliate commissions can only be included in payable staff batches.',
      );
      expect(() => assertStaffPayoutDirectionDetails({
        direction: 'payable',
        hasReimbursement: true,
        hasAffiliatePayout: true,
      })).not.toThrow();
    });

    it('rejects calculated payout intents in receivable batches but permits manual receivables', () => {
      const calculatedIntent: CompensationSettlementIntentPayload = {
        version: 2,
        direction: 'payable',
        userId: 24,
        rangeStart: '2026-08-01',
        rangeEnd: '2026-08-31',
        sourceKey: 'promotion_sales',
        componentId: null,
        category: 'affiliate_commission',
        destination: 'staff_vendor',
        fundId: null,
        grossAmountMinor: 8_000,
        outstandingAmountMinor: 8_000,
        ruleId: 42,
        currency: 'PLN',
        issuedAt: 1_777_464_000,
        segmentKey: 'seg_direction_bound',
        earningStart: '2026-08-01',
        earningEnd: '2026-08-31',
        staffTypePeriodId: 10,
        staffType: 'long_term',
        legacyExtrapolation: false,
        referenceIds: [9513],
      };

      expect(() => assertStaffPayoutSettlementIntentDirections({
        direction: 'payable',
        intents: [calculatedIntent],
      })).not.toThrow();
      expect(() => assertStaffPayoutSettlementIntentDirections({
        direction: 'receivable',
        intents: [],
      })).not.toThrow();
      expectHttpError(
        () => assertStaffPayoutSettlementIntentDirections({
          direction: 'receivable',
          intents: [calculatedIntent],
        }),
        400,
        'Calculated compensation authorizations can only be used in payable staff batches.',
      );
    });
  });

  describe('affiliate payout claims', () => {
    it('accepts non-overlapping bookings claimed for the payout staff member', () => {
      expect(() => assertUniqueStaffAffiliatePayoutClaims({
        staffUserId: 24,
        claims: [
          { affiliateUserId: 24, bookingIds: [9513, 9514] },
          { affiliateUserId: 24, bookingIds: [9515] },
        ],
      })).not.toThrow();
    });

    it('rejects an affiliate line attributed to a different user', () => {
      expectHttpError(
        () => assertUniqueStaffAffiliatePayoutClaims({
          staffUserId: 24,
          claims: [{ affiliateUserId: 25, bookingIds: [9513] }],
        }),
        400,
        'Affiliate payout user must match the staff payout user.',
      );
    });

    it('rejects a booking included in more than one affiliate payout line', () => {
      expectHttpError(
        () => assertUniqueStaffAffiliatePayoutClaims({
          staffUserId: 24,
          claims: [
            { affiliateUserId: 24, bookingIds: [9513, 9514] },
            { affiliateUserId: 24, bookingIds: [9514, 9515] },
          ],
        }),
        400,
        'Affiliate booking 9514 is included in more than one payout line.',
      );
    });
  });

  describe('finance selections', () => {
    const payableSelection = () => ({
      direction: 'payable' as const,
      lines: [{ accountId: 3, categoryId: 4, currency: 'pln' }],
      reimbursement: { accountId: 3, categoryId: 4 },
      accounts: [{ id: 3, currency: 'PLN', isActive: true }],
      categories: [{ id: 4, kind: 'expense', isActive: true }],
      baseCurrency: 'PLN',
    });

    it('returns authoritative account currencies for valid payable selections', () => {
      expect(validateStaffPayoutFinanceSelections(payableSelection())).toEqual({
        lineCurrencies: ['PLN'],
        reimbursementCurrency: 'PLN',
      });
    });

    it.each([
      { accounts: [], label: 'missing' },
      { accounts: [{ id: 3, currency: 'PLN', isActive: false }], label: 'inactive' },
    ])('rejects a $label payout account', ({ accounts }) => {
      expectHttpError(
        () => validateStaffPayoutFinanceSelections({ ...payableSelection(), accounts }),
        400,
        'lines[0].accountId must reference an active finance account.',
      );
    });

    it('rejects a client-supplied line currency that differs from the account', () => {
      expectHttpError(
        () => validateStaffPayoutFinanceSelections({
          ...payableSelection(),
          lines: [{ accountId: 3, categoryId: 4, currency: 'EUR' }],
        }),
        400,
        'lines[0].currency must match the selected account currency.',
      );
    });

    it.each([
      { kind: 'income', isActive: true, label: 'wrong-kind' },
      { kind: 'expense', isActive: false, label: 'inactive' },
    ])('rejects a $label category for a payable line', ({ kind, isActive }) => {
      expectHttpError(
        () => validateStaffPayoutFinanceSelections({
          ...payableSelection(),
          categories: [{ id: 4, kind, isActive }],
        }),
        400,
        'lines[0].categoryId must reference an active expense category.',
      );
    });

    it('requires an active income category for receivable lines', () => {
      const base = payableSelection();
      expect(validateStaffPayoutFinanceSelections({
        ...base,
        direction: 'receivable',
        reimbursement: null,
        categories: [{ id: 4, kind: 'income', isActive: true }],
      })).toEqual({ lineCurrencies: ['PLN'], reimbursementCurrency: null });

      expectHttpError(
        () => validateStaffPayoutFinanceSelections({
          ...base,
          direction: 'receivable',
          reimbursement: null,
        }),
        400,
        'lines[0].categoryId must reference an active income category.',
      );
    });

    it('requires the reimbursement account to use the configured base currency', () => {
      const base = payableSelection();
      expectHttpError(
        () => validateStaffPayoutFinanceSelections({
          ...base,
          lines: [{ accountId: 3, categoryId: 4, currency: 'EUR' }],
          accounts: [{ id: 3, currency: 'EUR', isActive: true }],
        }),
        400,
        'Reimbursements must be paid from an account in the finance base currency.',
      );
    });

    it.each([
      { accounts: [], label: 'missing' },
      { accounts: [{ id: 3, currency: 'PLN', isActive: false }], label: 'inactive' },
    ])('rejects a $label reimbursement account', ({ accounts }) => {
      const base = payableSelection();
      expectHttpError(
        () => validateStaffPayoutFinanceSelections({
          ...base,
          lines: [],
          accounts,
        }),
        400,
        'reimbursement.accountId must reference an active finance account.',
      );
    });

    it('requires an active expense category for reimbursements', () => {
      const base = payableSelection();
      expectHttpError(
        () => validateStaffPayoutFinanceSelections({
          ...base,
          lines: [],
          categories: [{ id: 4, kind: 'income', isActive: true }],
        }),
        400,
        'reimbursement.categoryId must reference an active expense category.',
      );
    });
  });

  describe('reimbursement provenance and total', () => {
    it('derives the authoritative total from base amounts and permits mixed original currencies', () => {
      const sources = [
        buildReimbursementSource(),
        buildReimbursementSource({
          id: 72,
          currency: 'EUR',
          amountMinor: 1_000,
          baseAmountMinor: 4_300,
          meta: null,
          counterpartyId: 8,
        }),
      ];

      expect(deriveReimbursement({
        requestedTransactionIds: [71, 72],
        requestedAmountMinor: 6_300,
        sourceRows: sources,
      })).toBe(6_300);
    });

    it('rejects duplicate or unresolved transaction IDs', () => {
      expectHttpError(
        () => deriveReimbursement({
          requestedTransactionIds: [71, 71],
          requestedAmountMinor: 4_000,
          sourceRows: [buildReimbursementSource(), buildReimbursementSource()],
        }),
        400,
        'Reimbursement entries must contain unique finance transaction IDs.',
      );
      expectHttpError(
        () => deriveReimbursement({ sourceRows: [] }),
        400,
        'One or more reimbursement transactions were not found.',
      );
    });

    it('accepts only expense transactions that are still awaiting reimbursement', () => {
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({ kind: 'income' })],
        }),
        400,
        'Finance transaction 71 is not an expense reimbursement.',
      );
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({ status: 'reimbursed' })],
        }),
        409,
        'Finance transaction 71 is no longer awaiting reimbursement.',
      );
    });

    it.each(['2026-06-30', '2026-08-01'])(
      'rejects a reimbursement dated outside the selected period (%s)',
      (date) => {
        expectHttpError(
          () => deriveReimbursement({ sourceRows: [buildReimbursementSource({ date })] }),
          400,
          'Finance transaction 71 is outside the selected payout period.',
        );
      },
    );

    it('requires explicit staff attribution or the staff-linked fallback vendor', () => {
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({
            meta: { paidByUserId: 25 },
            counterpartyId: 8,
          })],
        }),
        400,
        'Finance transaction 71 does not belong to the selected staff member.',
      );
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({ meta: null, counterpartyId: 9 })],
        }),
        400,
        'Finance transaction 71 does not belong to the selected staff member.',
      );
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({
            meta: null,
            counterpartyType: 'client',
            counterpartyId: 8,
          })],
        }),
        400,
        'Finance transaction 71 does not belong to the selected staff member.',
      );
    });

    it('rejects malformed source currency and base amounts', () => {
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({ currency: 'EURO' })],
        }),
        400,
        'Finance transaction 71 currency must be a valid three-letter currency code.',
      );
      expectHttpError(
        () => deriveReimbursement({
          sourceRows: [buildReimbursementSource({ baseAmountMinor: 0 })],
        }),
        400,
        'Finance transaction 71 has an invalid base amount.',
      );
    });

    it('rejects a stale client total instead of trusting the submitted amount', () => {
      expectHttpError(
        () => deriveReimbursement({ requestedAmountMinor: 1_999 }),
        409,
        'Reimbursement total changed. Refresh Pays and try again.',
      );
    });
  });
});
