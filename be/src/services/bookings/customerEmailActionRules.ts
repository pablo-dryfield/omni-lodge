export type CustomerEmailBookingMatch = {
  id: number;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  experienceDate?: string | null;
};

export const DEFAULT_CUSTOMER_EMAIL_ACTION_START_AT = '2026-08-06T00:00:00+02:00';

const uniquePositiveIntegers = (values: number[]): number[] =>
  Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0)));

export const customerEmailActionTargetsUser = ({
  targetUserIds,
  targetUserTypeIds,
  userId,
  userTypeId,
}: {
  targetUserIds: unknown;
  targetUserTypeIds: unknown;
  userId: number | null | undefined;
  userTypeId: number | null | undefined;
}): boolean => {
  const users = Array.isArray(targetUserIds)
    ? uniquePositiveIntegers(targetUserIds.map(Number))
    : [];
  const userTypes = Array.isArray(targetUserTypeIds)
    ? uniquePositiveIntegers(targetUserTypeIds.map(Number))
    : [];
  if (users.length === 0 && userTypes.length === 0) {
    return false;
  }
  if (users.length > 0 && (!userId || !users.includes(userId))) {
    return false;
  }
  if (userTypes.length > 0 && (!userTypeId || !userTypes.includes(userTypeId))) {
    return false;
  }
  return true;
};

export const shouldCloseCustomerEmailActionForAll = ({
  selectedAction,
  recipientUserIds,
  completedUserIds,
}: {
  selectedAction: unknown;
  recipientUserIds: number[];
  completedUserIds: number[];
}): boolean => {
  if (selectedAction === 'replied') {
    return true;
  }
  const recipients = uniquePositiveIntegers(recipientUserIds);
  const completed = new Set(uniquePositiveIntegers(completedUserIds));
  return recipients.length > 0 && recipients.every((userId) => completed.has(userId));
};

export const resolveCustomerEmailActionTargets = (
  participantUserIds: number[],
  operationsUserTypeIds: number[],
):
  | {
      routingMode: 'thread_participants' | 'operations_user_types';
      targetUserIds: number[] | null;
      targetUserTypeIds: number[] | null;
    }
  | null => {
  const participants = uniquePositiveIntegers(participantUserIds);
  if (participants.length > 0) {
    return {
      routingMode: 'thread_participants',
      targetUserIds: participants,
      targetUserTypeIds: null,
    };
  }
  const userTypes = uniquePositiveIntegers(operationsUserTypeIds);
  return userTypes.length > 0
    ? {
        routingMode: 'operations_user_types',
        targetUserIds: null,
        targetUserTypeIds: userTypes,
      }
    : null;
};

export const currentAndNextYearRange = (now = new Date()): [string, string] => {
  const year = Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Warsaw', year: 'numeric' }).format(now),
  );
  return [`${year}-01-01`, `${year + 1}-12-31`];
};

export const resolveCustomerEmailReceivedAt = (
  internalDate: string | null | undefined,
  dateHeader?: string,
): Date | null => {
  const internalTimestamp = Number(internalDate);
  const internal = Number.isFinite(internalTimestamp) ? new Date(internalTimestamp) : null;
  if (internal && !Number.isNaN(internal.getTime())) {
    return internal;
  }
  const headerDate = dateHeader ? new Date(dateHeader) : null;
  return headerDate && !Number.isNaN(headerDate.getTime()) ? headerDate : null;
};

export const resolveCustomerEmailActionStartAt = (configuredValue: unknown): Date => {
  const raw = typeof configuredValue === 'string' ? configuredValue.trim() : '';
  const hasExplicitTimezone =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
  const configured = hasExplicitTimezone ? new Date(raw) : null;
  if (configured && !Number.isNaN(configured.getTime())) {
    return configured;
  }
  return new Date(DEFAULT_CUSTOMER_EMAIL_ACTION_START_AT);
};

export const buildCustomerEmailGmailQuery = (startAt: Date): string => {
  // Gmail's `after` operator is exclusive. Search one second earlier, then apply
  // the exact inclusive boundary against internalDate after fetching the message.
  const afterEpochSeconds = Math.max(0, Math.floor(startAt.getTime() / 1000) - 1);
  return `in:inbox after:${afterEpochSeconds}`;
};

export const buildCustomerEmailRequiredAction = ({
  gmailMessageId,
  gmailThreadId,
  customerEmail,
  subject,
  snippet,
  textBody,
  internalDate,
  dateHeader,
  bookings,
}: {
  gmailMessageId: string;
  gmailThreadId: string | null;
  customerEmail: string;
  subject: string;
  snippet: string | null;
  textBody: string;
  internalDate: string | null;
  dateHeader?: string;
  bookings: CustomerEmailBookingMatch[];
}) => {
  const customerName = [bookings[0]?.guestFirstName, bookings[0]?.guestLastName]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const replySubject = subject.trim();
  const receivedAt =
    resolveCustomerEmailReceivedAt(internalDate, dateHeader)?.toISOString() ?? new Date().toISOString();
  const bookingDates = Array.from(
    new Set(bookings.map((booking) => String(booking.experienceDate ?? '').trim()).filter(Boolean)),
  );

  return {
    type: 'customer_email' as const,
    title: `Email from ${customerName || customerEmail}`,
    body: replySubject || '(No subject)',
    payload: {
      gmailMessageId,
      gmailThreadId,
      customerEmail,
      customerName: customerName || null,
      subject: replySubject,
      snippet: snippet ?? textBody.slice(0, 240),
      receivedAt,
      bookingIds: bookings.map((booking) => Number(booking.id)),
      bookingDates,
      manifestDate: bookingDates[0] ?? null,
    },
    requiresCompletion: true,
    requiresSignature: false,
    startsAt: null,
    status: true,
    createdBy: null,
    updatedBy: null,
  };
};
