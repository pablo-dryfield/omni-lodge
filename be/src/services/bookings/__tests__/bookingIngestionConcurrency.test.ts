jest.mock('../../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../../models/BookingEmail.js', () => ({ __esModule: true, default: {
  findOne: jest.fn(), findAll: jest.fn(), findOrCreate: jest.fn(),
} }));
jest.mock('../../configService.js', () => ({ getConfigValue: jest.fn(() => null) }));
jest.mock('../../../utils/logger.js', () => ({ __esModule: true, default: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../gmailClient.js', () => ({
  fetchMessagePayload: jest.fn(), listMessages: jest.fn(), hasBackupGmailAccount: jest.fn(() => false),
  isGmailRateLimitError: jest.fn(error => Boolean(error?.rateLimited)),
  isGmailCooldownError: jest.fn(error => Boolean(error?.cooldown)),
}));
jest.mock('../parsers/index.js', () => ({ getBookingParsers: jest.fn(() => []) }));

import BookingEmail from '../../../models/BookingEmail.js';
import logger from '../../../utils/logger.js';
import { fetchMessagePayload, listMessages } from '../gmailClient.js';
import { ingestAllBookingEmails, ingestLatestBookingEmails, processBookingEmail, saveEmailRecord } from '../bookingIngestionService.js';
import { describeBookingIngestionFailure } from '../bookingIngestionFailure.js';
import type { GmailMessagePayload } from '../gmailClient.js';

const payload = (id: string): GmailMessagePayload => ({ sourceAccount: 'primary', message: { id, internalDate: '1794654000000', payload: { headers: [] } },
  headers: { from: 'noreply@example.invalid', subject: 'Fixture' }, textBody: 'An unrelated message', htmlBody: null });
let records: Map<string, BookingEmail>;
const duplicate = () => Object.assign(new Error('Private SQL value customer@example.invalid sk_live_do_not_log'), {
  name: 'SequelizeUniqueConstraintError', original: { code: '23505', constraint: 'booking_emails_message_id_key' },
  fields: { messageId: 'private-content' }, errors: [{ path: 'messageId', value: 'private-content' }],
});
beforeEach(() => {
  jest.clearAllMocks(); records = new Map();
  jest.mocked(BookingEmail.findOne).mockImplementation(async (options: any) => records.get(options.where.messageId) ?? null);
  jest.mocked(BookingEmail.findAll).mockImplementation(async () => [...records.values()].filter(row => ['processed', 'ignored'].includes(row.ingestionStatus)));
  jest.mocked(BookingEmail.findOrCreate).mockImplementation(async (options: any) => {
    const id = options.where.messageId;
    const record = records.get(id) ?? { id: records.size + 1, ...options.defaults, save: jest.fn(async () => undefined) } as unknown as BookingEmail;
    records.set(id, record); return [record, true];
  });
  jest.mocked(fetchMessagePayload).mockImplementation(async id => payload(id));
  jest.mocked(listMessages).mockResolvedValue({ messages: [{ id: 'bad' }, { id: 'good' }], nextPageToken: null, totalSizeEstimate: 2 } as never);
});

it('continues to later messages after a persistence failure and retries the failed message on the next poll', async () => {
  jest.mocked(BookingEmail.findOrCreate).mockRejectedValueOnce(duplicate());
  await ingestLatestBookingEmails();
  expect(records.has('bad')).toBe(false);
  expect(records.get('good')?.ingestionStatus).toBe('ignored');
  const failure = jest.mocked(logger.error).mock.calls.map(args => args[0]).join('\n');
  expect(failure).toContain('Message bad failed before completion');
  expect(failure).toContain('SequelizeUniqueConstraintError'); expect(failure).toContain('23505');
  expect(failure).not.toContain('customer@example.invalid'); expect(failure).not.toContain('sk_live');
  expect(failure).not.toContain('private-content');
  await ingestLatestBookingEmails();
  expect(records.get('bad')?.ingestionStatus).toBe('ignored');
  expect(fetchMessagePayload).toHaveBeenCalledTimes(3);
});

it('shares an overlapping cron/manual poll and releases the guard after completion', async () => {
  let release!: (value: any) => void;
  jest.mocked(listMessages).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const first = ingestLatestBookingEmails(); const second = ingestLatestBookingEmails();
  expect(first).toBe(second); expect(listMessages).toHaveBeenCalledTimes(1);
  release({ messages: [], nextPageToken: null }); await first;
  await ingestLatestBookingEmails(); expect(listMessages).toHaveBeenCalledTimes(2);
});

it('shares an ordinary message fetch and clears rejected work so a later retry can proceed', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(fetchMessagePayload).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const first = processBookingEmail('same'); const second = processBookingEmail('same');
  expect(first).toBe(second);
  // The terminal-state lookup precedes the provider request.
  await Promise.resolve();
  reject(Object.assign(new Error('Provider cooldown'), { rateLimited: true }));
  await expect(first).rejects.toMatchObject({ rateLimited: true });
  await expect(processBookingEmail('same')).resolves.toBe('ignored');
  expect(fetchMessagePayload).toHaveBeenCalledTimes(2);
});

it.each([{ rateLimited: true }, { cooldown: true }])('stops on a real provider limit and permits a later poll: %j', async marker => {
  jest.mocked(fetchMessagePayload).mockRejectedValueOnce(Object.assign(new Error('Provider limit'), marker));
  await ingestLatestBookingEmails();
  expect(fetchMessagePayload).toHaveBeenCalledTimes(1); expect(records.size).toBe(0);
  await ingestLatestBookingEmails(); expect(records.get('good')?.ingestionStatus).toBe('ignored');
});

it('continues a paginated backfill after an individual save fails', async () => {
  jest.mocked(BookingEmail.findOrCreate).mockRejectedValueOnce(duplicate());
  await ingestAllBookingEmails();
  // Backfills deliberately process each page in reverse order.
  expect(records.get('bad')?.ingestionStatus).toBe('ignored');
  expect(records.has('good')).toBe(false);
});

it('keeps the terminal forwarded-RFC duplicate instead of inserting another message', async () => {
  const saved = { id: 9, messageId: 'original', ingestionStatus: 'processed' } as BookingEmail;
  jest.mocked(BookingEmail.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
  const input = payload('forwarded'); input.headers['message-id'] = '<same@example.invalid>';
  expect(await saveEmailRecord(input)).toBe(saved);
  expect(BookingEmail.findOrCreate).not.toHaveBeenCalled();
});

it('uses atomic creation and preserves the winning row terminal status', async () => {
  const winner = { id: 3, messageId: 'same', ingestionStatus: 'processed', save: jest.fn() } as unknown as BookingEmail;
  jest.mocked(BookingEmail.findOne).mockResolvedValueOnce(null);
  jest.mocked(BookingEmail.findOrCreate).mockResolvedValueOnce([winner, false]);
  expect((await saveEmailRecord(payload('same'))).ingestionStatus).toBe('processed');
  expect(winner.save).toHaveBeenCalled();
});

it('excludes private field values and arbitrary provider text from failure diagnostics', () => {
  expect(describeBookingIngestionFailure(duplicate())).toBe('SequelizeUniqueConstraintError; SQLSTATE 23505; constraint booking_emails_message_id_key; fields messageId');
  expect(describeBookingIngestionFailure({ name: 'customer@example.invalid', original: { constraint: 'secret with spaces' }, fields: { 'unsafe\nfield': 'private' } })).toBe('Error');
});
