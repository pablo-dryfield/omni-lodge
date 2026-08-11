const mockGmailSend = jest.fn();
const mockGmailGet = jest.fn();
const mockGetAccessToken = jest.fn();

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
          list: jest.fn(),
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
  getConfigValue: jest.fn((key: string) => `${key.toLowerCase()}-value`),
}));

import {
  isGmailRateLimitError,
  resolveGmailRetryAfterAt,
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
});
