import { normalizeForwardedBackupPayload } from '../forwardedEmailNormalizer.js';
import type { GmailMessagePayload } from '../gmailClient.js';

const buildPayload = (
  sourceAccount: GmailMessagePayload['sourceAccount'],
  overrides: Partial<GmailMessagePayload> = {},
): GmailMessagePayload => ({
  sourceAccount,
  message: {
    id: sourceAccount === 'backup' ? 'backup:wrapper-id' : 'primary-id',
    threadId: 'thread-id',
    internalDate: '1786446000000',
  },
  headers: {
    from: 'Krawl Through Krakow <pubthroughkrakow@gmail.com>',
    to: 'krawlthroughkrakowleader@gmail.com',
    subject: 'Fwd: Krawl Through Krakow: New order #NC7JO',
    date: 'Tue, 11 Aug 2026 09:00:00 +0200',
  },
  textBody: [
    'Please see the booking below.',
    '',
    '---------- Forwarded message ---------',
    'From: Ecwid <notifications@ecwid.com>',
    'Date: Tue, 11 Aug 2026 at 07:12',
    'Subject: Krawl Through Krakow: New order #NC7JO',
    'To: Krawl Through Krakow <pubthroughkrakow@gmail.com>',
    '',
    'You received a new order.',
    'Order #NC7JO',
  ].join('\n'),
  htmlBody: '<div>Forwarded wrapper</div>',
  ...overrides,
});

describe('normalizeForwardedBackupPayload', () => {
  it('unwraps a manually forwarded Gmail message from the backup mailbox', () => {
    const normalized = normalizeForwardedBackupPayload(buildPayload('backup'));

    expect(normalized.headers.from).toBe('Ecwid <notifications@ecwid.com>');
    expect(normalized.headers.to).toBe('Krawl Through Krakow <pubthroughkrakow@gmail.com>');
    expect(normalized.headers.subject).toBe('Krawl Through Krakow: New order #NC7JO');
    expect(normalized.headers.date).toBe('Tue, 11 Aug 2026 at 07:12');
    expect(normalized.headers['x-omnilodge-forwarded-manual']).toBe('true');
    expect(normalized.headers['x-omnilodge-forwarded-by']).toContain('pubthroughkrakow@gmail.com');
    expect(normalized.textBody).toBe('You received a new order.\nOrder #NC7JO');
    expect(normalized.htmlBody).toBeNull();
  });

  it('does not unwrap forwarded-looking messages read from the primary mailbox', () => {
    const payload = buildPayload('primary');

    expect(normalizeForwardedBackupPayload(payload)).toBe(payload);
  });

  it('leaves unrelated backup messages unchanged', () => {
    const payload = buildPayload('backup', {
      headers: { from: 'someone@example.com', subject: 'A normal email' },
      textBody: 'No forwarded message block here.',
    });

    expect(normalizeForwardedBackupPayload(payload)).toBe(payload);
  });
});
