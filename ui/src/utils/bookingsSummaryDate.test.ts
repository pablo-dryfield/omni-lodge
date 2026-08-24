import {
  BOOKINGS_SUMMARY_TIMEZONE,
  buildBookingsRevenueTrend,
  resolveBookingsSummaryDate,
} from './bookingsSummaryDate';

describe('Bookings Summary date basis', () => {
  const order = {
    date: '2026-08-10',
    sourceReceivedAt: '2026-08-01T21:30:00.000Z',
  };

  it('uses the experience date when Experience Date is selected', () => {
    expect(resolveBookingsSummaryDate(order, 'experience_date')).toBe('2026-08-10');
  });

  it('uses the Warsaw calendar date when Source Received At is selected', () => {
    expect(BOOKINGS_SUMMARY_TIMEZONE).toBe('Europe/Warsaw');
    expect(resolveBookingsSummaryDate(order, 'source_received_at')).toBe('2026-08-01');
  });

  it('moves a UTC timestamp after the Warsaw midnight boundary into the next day', () => {
    expect(
      resolveBookingsSummaryDate(
        { ...order, sourceReceivedAt: '2026-08-01T22:30:00.000Z' },
        'source_received_at',
      ),
    ).toBe('2026-08-02');
  });

  it('does not fall back to an unrelated experience date when the received date is missing', () => {
    expect(
      resolveBookingsSummaryDate({ ...order, sourceReceivedAt: null }, 'source_received_at'),
    ).toBeNull();
    expect(
      resolveBookingsSummaryDate(
        { ...order, sourceReceivedAt: 'not-a-timestamp' },
        'source_received_at',
      ),
    ).toBeNull();
  });

  it('groups and sorts revenue by the selected date basis', () => {
    const rows = [
      {
        date: '2026-08-10',
        sourceReceivedAt: '2026-08-01T21:30:00.000Z',
        netRevenue: 110,
        processingFee: 10,
        refundedAmount: 5,
        people: 2,
      },
      {
        date: '2026-08-10',
        sourceReceivedAt: '2026-08-01T22:30:00.000Z',
        netRevenue: 55,
        processingFee: 5,
        refundedAmount: 0,
        people: 1,
      },
    ];

    expect(buildBookingsRevenueTrend(rows, 'experience_date')).toEqual([
      {
        date: '2026-08-10',
        label: '08-10',
        revenue: 150,
        refunds: 5,
        bookings: 2,
        people: 3,
      },
    ]);
    expect(buildBookingsRevenueTrend(rows, 'source_received_at')).toEqual([
      {
        date: '2026-08-01',
        label: '08-01',
        revenue: 100,
        refunds: 5,
        bookings: 1,
        people: 2,
      },
      {
        date: '2026-08-02',
        label: '08-02',
        revenue: 50,
        refunds: 0,
        bookings: 1,
        people: 1,
      },
    ]);
  });
});
