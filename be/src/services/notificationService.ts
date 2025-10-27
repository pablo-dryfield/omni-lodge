import nodemailer, { Transporter } from 'nodemailer';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

type NotificationChannel = 'in_app' | 'email';

type TemplateKey =
  | 'availability_reminder_first'
  | 'availability_reminder_final'
  | 'submissions_locked'
  | 'assignment_published'
  | 'swap_request'
  | 'swap_partner_accept'
  | 'swap_manager_decision';

type TemplateConfig = {
  channels: NotificationChannel[];
  subject: (payload: Record<string, unknown>) => string;
  html: (payload: Record<string, unknown>) => string;
};

const SCHED_TZ = process.env.SCHED_TZ || 'Europe/Warsaw';

const templateLibrary: Record<TemplateKey, TemplateConfig> = {
  availability_reminder_first: {
    channels: ['in_app', 'email'],
    subject: (payload) => `Reminder: Submit availability for week ${payload.weekLabel}`,
    html: (payload) => `
      <p>Hi ${(payload.firstName as string | undefined) ?? ''},</p>
      <p>This is a friendly reminder to submit your availability for <strong>week ${payload.weekLabel}</strong>.</p>
      <p>Please fill it in before <strong>${payload.deadline}</strong>.</p>
      <p>Thank you!</p>
    `,
  },
  availability_reminder_final: {
    channels: ['in_app', 'email'],
    subject: (payload) => `Final reminder: availability closes soon (week ${payload.weekLabel})`,
    html: (payload) => `
      <p>Hi ${(payload.firstName as string | undefined) ?? ''},</p>
      <p>This is the final reminder to submit your availability for <strong>week ${payload.weekLabel}</strong>.</p>
      <p>Submissions close at <strong>${payload.deadline}</strong>.</p>
      <p>Please take a moment to complete it now.</p>
    `,
  },
  submissions_locked: {
    channels: ['in_app', 'email'],
    subject: (payload) => `Availability locked for week ${payload.weekLabel}`,
    html: (payload) => `
      <p>Hi ${(payload.firstName as string | undefined) ?? ''},</p>
      <p>Availability submissions are now locked for <strong>week ${payload.weekLabel}</strong>.</p>
      <p>You can start assigning shifts.</p>
    `,
  },
  assignment_published: {
    channels: ['in_app', 'email'],
    subject: (payload) => `Your shifts for week ${payload.weekLabel}`,
    html: (payload) => {
      const assignments = Array.isArray(payload.assignments)
        ? payload.assignments as Array<Record<string, unknown>>
        : [];
      const list = assignments
        .map((assignment) => {
          const day = assignment.day as string | undefined;
          const type = assignment.shiftType as string | undefined;
          const start = assignment.timeStart as string | undefined;
          const role = assignment.roleInShift as string | undefined;
          return `<li><strong>${day}</strong> – ${type ?? 'Shift'} (${start ?? 'TBD'}) as ${role ?? 'Staff'}</li>`;
        })
        .join('');
      return `
        <p>Hi ${(payload.firstName as string | undefined) ?? ''},</p>
        <p>Your assignments for <strong>week ${payload.weekLabel}</strong> are confirmed:</p>
        <ul>${list}</ul>
        <p>See you soon!</p>
      `;
    },
  },
  swap_request: {
    channels: ['in_app', 'email'],
    subject: (payload) => `Swap request: ${payload.shiftType ?? 'Shift'} on ${payload.day}`,
    html: (payload) => `
      <p>Hi ${(payload.firstName as string | undefined) ?? ''},</p>
      <p>${payload.requesterName} would like to swap the <strong>${payload.shiftType}</strong> shift on <strong>${payload.day}</strong>.</p>
      <p>Please review and respond in the Scheduling app.</p>
    `,
  },
  swap_partner_accept: {
    channels: ['in_app'],
    subject: (payload) => `Swap accepted: ${payload.shiftType ?? 'Shift'} on ${payload.day}`,
    html: (payload) => `
      <p>Your swap with ${payload.partnerName} for <strong>${payload.shiftType}</strong> on <strong>${payload.day}</strong> was accepted and awaits manager approval.</p>
    `,
  },
  swap_manager_decision: {
    channels: ['in_app', 'email'],
    subject: (payload) => `Swap ${payload.decision === 'approved' ? 'approved' : 'denied'}: ${payload.shiftType ?? 'Shift'} on ${payload.day}`,
    html: (payload) => `
      <p>Hi ${(payload.firstName as string | undefined) ?? ''},</p>
      <p>Your swap request for <strong>${payload.shiftType}</strong> on <strong>${payload.day}</strong> was <strong>${payload.decision}</strong>.</p>
      ${payload.reason ? `<p>Reason: ${payload.reason}</p>` : ''}
    `,
  },
};

let transporter: Transporter | null = null;

function ensureTransporter(): Transporter | null {
  if (transporter) {
    return transporter;
  }

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    logger.warn('Email transport not configured. Set SMTP_HOST/PORT/USER/PASS to enable email notifications.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

async function sendEmail(template: TemplateConfig, user: User, payload: Record<string, unknown>): Promise<void> {
  const email = user.email;
  if (!email) {
    logger.warn(`Skipping email notification for user ${user.id}: missing email`);
    return;
  }

  const activeTransporter = ensureTransporter();
  if (!activeTransporter) {
    return;
  }

  const from = process.env.SMTP_FROM ?? 'noreply@omni-lodge.test';

  try {
    await activeTransporter.sendMail({
      from,
      to: email,
      subject: template.subject(payload),
      html: template.html(payload),
    });
  } catch (error) {
    logger.error(`Failed to send notification email to ${email}: ${(error as Error).message}`);
  }
}

async function persistNotification(userId: number, templateKey: TemplateKey, payload: Record<string, unknown>, channel: NotificationChannel): Promise<void> {
  await Notification.create({
    userId,
    channel,
    templateKey,
    payloadJson: payload,
    sentAt: dayjs().tz(SCHED_TZ).toDate(),
  });
}

export async function sendSchedulingNotification(options: {
  user: User;
  templateKey: TemplateKey;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { user, templateKey, payload } = options;
  const template = templateLibrary[templateKey];
  if (!template) {
    logger.warn(`Unknown notification template ${templateKey}`);
    return;
  }

  const normalizedPayload = {
    ...payload,
    firstName: payload.firstName ?? user.firstName,
    sentAt: dayjs().tz(SCHED_TZ).toISOString(),
  };

  const operations: Array<Promise<void>> = [];

  if (template.channels.includes('in_app')) {
    operations.push(persistNotification(user.id, templateKey, normalizedPayload, 'in_app'));
  }

  if (template.channels.includes('email')) {
    operations.push((async () => {
      await persistNotification(user.id, templateKey, normalizedPayload, 'email');
      await sendEmail(template, user, normalizedPayload);
    })());
  }

  await Promise.all(operations);
}
