import {
  buildCustomerEmailGmailQuery,
  buildCustomerEmailRequiredAction,
  customerEmailActionTargetsUser,
  currentAndNextYearRange,
  resolveCustomerEmailActionStartAt,
  resolveCustomerEmailActionTargets,
  resolveCustomerEmailReceivedAt,
  shouldCloseCustomerEmailActionForAll,
} from './customerEmailActionRules';

describe('customer email action rules', () => {
  it('limits qualifying bookings to the current and next Warsaw calendar years', () => {
    expect(currentAndNextYearRange(new Date('2026-08-06T10:00:00Z'))).toEqual([
      '2026-01-01',
      '2027-12-31',
    ]);
  });

  it('uses the configured Warsaw start time as an exact Gmail and server-side boundary', () => {
    const startAt = resolveCustomerEmailActionStartAt('2026-08-06T00:00:00+02:00');
    const before = resolveCustomerEmailReceivedAt(
      String(new Date('2026-08-05T23:59:59+02:00').getTime()),
    );
    const atBoundary = resolveCustomerEmailReceivedAt(
      String(new Date('2026-08-06T00:00:00+02:00').getTime()),
    );

    expect(startAt.toISOString()).toBe('2026-08-05T22:00:00.000Z');
    expect(buildCustomerEmailGmailQuery(startAt)).toBe('in:inbox after:1785967199');
    expect(before!.getTime()).toBeLessThan(startAt.getTime());
    expect(atBoundary!.getTime()).toBe(startAt.getTime());
  });

  it('falls back to the launch boundary when a start time is missing or has no timezone', () => {
    expect(resolveCustomerEmailActionStartAt('2026-08-06T00:00:00').toISOString()).toBe(
      '2026-08-05T22:00:00.000Z',
    );
  });

  it('prefers Gmail internalDate over a conflicting sender Date header', () => {
    const receivedAt = resolveCustomerEmailReceivedAt(
      String(new Date('2026-08-06T08:00:00Z').getTime()),
      'Wed, 5 Aug 2026 08:00:00 +0200',
    );

    expect(receivedAt?.toISOString()).toBe('2026-08-06T08:00:00.000Z');
  });

  it('builds a globally deduplicated email request payload with booking context', () => {
    const action = buildCustomerEmailRequiredAction({
      gmailMessageId: 'gmail-message-1',
      gmailThreadId: 'gmail-thread-1',
      customerEmail: 'alex@example.com',
      subject: 'Re: Booking Information',
      snippet: 'Can I change my meeting point?',
      textBody: 'Can I change my meeting point?',
      internalDate: String(new Date('2026-08-06T10:00:00Z').getTime()),
      dateHeader: 'Thu, 6 Aug 2026 12:00:00 +0200',
      bookings: [
        {
          id: 123,
          guestFirstName: 'Alex',
          guestLastName: 'Guest',
          experienceDate: '2026-08-10',
        },
      ],
    });

    expect(action).toEqual(
      expect.objectContaining({
        type: 'customer_email',
        title: 'Email from Alex Guest',
        requiresCompletion: true,
        payload: expect.objectContaining({
          gmailMessageId: 'gmail-message-1',
          gmailThreadId: 'gmail-thread-1',
          customerEmail: 'alex@example.com',
          bookingIds: [123],
          manifestDate: '2026-08-10',
        }),
      }),
    );
  });

  it('routes established Gmail threads only to the staff users who participated', () => {
    expect(resolveCustomerEmailActionTargets([17, 22, 17], [1, 2, 3, 4])).toEqual({
      routingMode: 'thread_participants',
      targetUserIds: [17, 22],
      targetUserTypeIds: null,
    });
  });

  it('routes unsolicited emails to the configured operations user types', () => {
    expect(resolveCustomerEmailActionTargets([], [1, 2, 3, 4])).toEqual({
      routingMode: 'operations_user_types',
      targetUserIds: null,
      targetUserTypeIds: [1, 2, 3, 4],
    });
  });

  it('keeps a broadcast email open until every targeted user completes it', () => {
    expect(
      shouldCloseCustomerEmailActionForAll({
        selectedAction: 'completed',
        recipientUserIds: [17, 22],
        completedUserIds: [17],
      }),
    ).toBe(false);
    expect(
      shouldCloseCustomerEmailActionForAll({
        selectedAction: 'completed',
        recipientUserIds: [17, 22],
        completedUserIds: [17, 22],
      }),
    ).toBe(true);
  });

  it('closes a customer email for everyone immediately after a reply', () => {
    expect(
      shouldCloseCustomerEmailActionForAll({
        selectedAction: 'replied',
        recipientUserIds: [17, 22],
        completedUserIds: [17],
      }),
    ).toBe(true);
  });

  it('matches customer email actions to their exact user or user type targets', () => {
    expect(
      customerEmailActionTargetsUser({
        targetUserIds: null,
        targetUserTypeIds: [3, 4],
        userId: 17,
        userTypeId: 3,
      }),
    ).toBe(true);
    expect(
      customerEmailActionTargetsUser({
        targetUserIds: [22],
        targetUserTypeIds: null,
        userId: 17,
        userTypeId: 3,
      }),
    ).toBe(false);
  });
});
