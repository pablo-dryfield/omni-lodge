const mockSmtpSend = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSmtpSend }));
const mockGmailSend = jest.fn();
const mockGoogleClient = jest.fn();
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => mockCreateTransport() } }));
jest.mock('googleapis', () => ({ google: { gmail: () => mockGmailSend(), auth: { OAuth2: () => mockGoogleClient() } } }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn((key: string) => key === 'SCHED_TZ' ? 'Europe/Warsaw' : 'configured') }));
jest.mock('../../models/Notification.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn() } }));

import { sendMessage } from '../bookings/gmailClient';
import { sendDirectEmail, sendSchedulingNotification } from '../notificationService';
import Notification from '../../models/Notification';
import type User from '../../models/User';

const original = process.env.DISABLE_OUTBOUND_EMAIL;
beforeEach(() => { jest.clearAllMocks(); process.env.DISABLE_OUTBOUND_EMAIL = 'true'; });
afterAll(() => {
  if (original === undefined) delete process.env.DISABLE_OUTBOUND_EMAIL;
  else process.env.DISABLE_OUTBOUND_EMAIL = original;
});

it('rejects Gmail delivery before credentials, primary/backup clients, or network are used', async () => {
  await expect(sendMessage({ to: 'preview@example.test', subject: 'Local preview', textBody: 'Not sent' }))
    .rejects.toMatchObject({ status: 503 });
  expect(mockGoogleClient).not.toHaveBeenCalled();
  expect(mockGmailSend).not.toHaveBeenCalled();
});

it('rejects SMTP delivery before a transport is created and cannot fall back to sending', async () => {
  await expect(sendDirectEmail({ to: 'preview@example.test', subject: 'Local preview', html: '<p>Not sent</p>' }))
    .rejects.toMatchObject({ status: 503 });
  expect(mockCreateTransport).not.toHaveBeenCalled();
  expect(mockSmtpSend).not.toHaveBeenCalled();
});

it('keeps in-app notifications working without recording an email as sent', async () => {
  await sendSchedulingNotification({ user: { id: 1, firstName: 'Local', email: 'preview@example.test' } as User,
    templateKey: 'assignment_published', payload: { day: '2026-11-13' } });
  expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({ channel: 'in_app' }));
  expect(Notification.create).not.toHaveBeenCalledWith(expect.objectContaining({ channel: 'email' }));
  expect(mockCreateTransport).not.toHaveBeenCalled();
});
