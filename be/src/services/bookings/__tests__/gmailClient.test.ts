const mockGmailSend = jest.fn();
const mockGmailGet = jest.fn();
const mockGmailList = jest.fn();
const mockGetAccessToken = jest.fn();
const mockConfigValues = new Map<string, unknown>();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        getAccessToken: mockGetAccessToken,
      })),
    },
    gmail: jest.fn(() => ({
      users: {
        messages: {
          send: mockGmailSend,
          get: mockGmailGet,
          list: mockGmailList,
        },
        settings: {
          sendAs: {
            list: jest.fn(),
          },
        },
      },
    })),
  },
}));

jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn((key: string) => {
    if (mockConfigValues.has(key)) return mockConfigValues.get(key);
    if (key === 'GOOGLE_CLIENT_ID') return 'client-id';
    if (key === 'GOOGLE_CLIENT_SECRET') return 'client-secret';
    if (key === 'GOOGLE_REFRESH_TOKEN') return 'shared-refresh-token';
    return null;
  }),
}));

import {
  describeGmailApiError,
  isGmailRateLimitError,
  resolveGmailRetryAfterAt,
  listMessages,
  fetchMessagePayload,
  sendMessage,
} from '../gmailClient';

describe('Gmail quota errors', () => {
  it('recognizes a Gmail 403 user-rate error as retryable quota pressure', () => {
    expect(
      isGmailRateLimitError({
        response: {
          status: 403,
          data: {
            error: {
              errors: [{ reason: 'userRateLimitExceeded', message: 'User-rate limit exceeded.' }],
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('does not retry unrelated Gmail permission errors as quota pressure', () => {
    expect(
      isGmailRateLimitError({
        response: {
          status: 403,
          data: { error: { errors: [{ reason: 'domainPolicy' }] } },
        },
      }),
    ).toBe(false);
  });

  it('summarizes the HTTP status and Google reason without logging the response body', () => {
    expect(
      describeGmailApiError({
        response: {
          status: 429,
          data: {
            error: {
              status: 'RESOURCE_EXHAUSTED',
              errors: [{ reason: 'userRateLimitExceeded' }],
            },
          },
        },
      }),
    ).toBe('httpStatus=429 reason=userRateLimitExceeded apiStatus=RESOURCE_EXHAUSTED');
  });

  it('honors the absolute retry timestamp returned in a Gmail error message', () => {
    expect(
      resolveGmailRetryAfterAt({
        message:
          'User-rate limit exceeded. Retry after 2026-08-11T11:38:10.449Z',
      }),
    ).toBe(Date.parse('2026-08-11T11:38:10.449Z'));
  });

  it('honors a Retry-After header expressed in seconds', () => {
    const now = Date.parse('2026-08-11T11:23:10.000Z');
    expect(
      resolveGmailRetryAfterAt(
        { response: { headers: { 'retry-after': '900' } } },
        now,
      ),
    ).toBe(now + 900_000);
  });
});

describe('Gmail threaded replies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigValues.clear();
    mockGetAccessToken.mockResolvedValue('access-token');
    mockGmailSend.mockResolvedValue({
      data: { id: 'sent-message-id', threadId: 'gmail-thread-id', labelIds: ['SENT'] },
    });
    mockGmailGet.mockResolvedValue({
      data: {
        id: 'sent-message-id',
        threadId: 'gmail-thread-id',
        labelIds: ['SENT'],
        payload: { headers: [{ name: 'Message-ID', value: '<sent-message@example.com>' }] },
      },
    });
  });

  it('uses persistent backup message references when reading the forwarded mailbox', async () => {
    mockConfigValues.set('GMAIL_SEND_REFRESH_TOKEN', 'backup-user-token');
    mockGmailList.mockResolvedValueOnce({
      data: { messages: [{ id: 'gmail-backup-id', threadId: 'backup-thread-id' }] },
    });

    const listed = await listMessages({ maxResults: 10 }, 'backup');
    expect(listed.messages[0]?.id).toBe('backup:gmail-backup-id');

    await fetchMessagePayload('backup:gmail-backup-id');
    expect(mockGmailGet).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'gmail-backup-id', userId: 'me' }),
    );
  });

  it('supplies Gmail thread metadata and RFC reply headers', async () => {
    await sendMessage({
      to: 'customer@example.com',
      subject: 'Booking information',
      textBody: 'Thanks for getting back to us.',
      threadId: 'gmail-thread-id',
      inReplyTo: '<customer-reply@example.com>',
      references: '<original-message@example.com> <customer-reply@example.com>',
    });

    expect(mockGmailSend).toHaveBeenCalledTimes(1);
    const request = mockGmailSend.mock.calls[0][0];
    expect(request.requestBody).toEqual({
      raw: expect.any(String),
      threadId: 'gmail-thread-id',
    });
    expect(request.media).toBeUndefined();

    const rawMessage = Buffer.from(request.requestBody.raw, 'base64url').toString('utf-8');
    expect(rawMessage).toContain('In-Reply-To: <customer-reply@example.com>');
    expect(rawMessage).toContain(
      'References: <original-message@example.com> <customer-reply@example.com>',
    );
  });

  it('fails over to the backup Gmail user on a primary-account quota error', async () => {
    mockConfigValues.set('GMAIL_SEND_REFRESH_TOKEN', 'backup-user-token');
    mockGmailSend
      .mockRejectedValueOnce({
        response: {
          status: 429,
          data: {
            error: {
              status: 'RESOURCE_EXHAUSTED',
              errors: [{ reason: 'userRateLimitExceeded' }],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: { id: 'backup-message-id', threadId: 'backup-thread-id', labelIds: ['SENT'] },
      });

    await sendMessage({
      to: 'customer@example.com',
      subject: 'Booking information',
      textBody: 'Thanks for getting back to us.',
      threadId: 'thread-from-ingestion-mailbox',
      inReplyTo: '<customer-reply@example.com>',
      references: '<customer-reply@example.com>',
    });

    expect(mockGmailSend).toHaveBeenCalledTimes(2);
    const request = mockGmailSend.mock.calls[1][0];
    expect(request.requestBody).toEqual({ raw: expect.any(String) });
    const rawMessage = Buffer.from(request.requestBody.raw, 'base64url').toString('utf-8');
    expect(rawMessage).toContain('In-Reply-To: <customer-reply@example.com>');
  });
});
