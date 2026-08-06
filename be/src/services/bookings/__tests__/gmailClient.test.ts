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

import { sendMessage } from '../gmailClient';

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
    expect(request.requestBody).toEqual({ threadId: 'gmail-thread-id' });

    const rawMessage = (request.media.body as Buffer).toString('utf-8');
    expect(rawMessage).toContain('In-Reply-To: <customer-reply@example.com>');
    expect(rawMessage).toContain(
      'References: <original-message@example.com> <customer-reply@example.com>',
    );
  });
});
