import { col, fn, literal, Op, UniqueConstraintError, where as sequelizeWhere } from 'sequelize';
import Booking from '../../models/Booking.js';
import RequiredAction from '../../models/RequiredAction.js';
import UserType from '../../models/UserType.js';
import { getConfigValue } from '../configService.js';
import logger from '../../utils/logger.js';
import { extractEmailAddress, fetchMessagePayload, listMessages } from './gmailClient.js';
import {
  buildCustomerEmailGmailQuery,
  buildCustomerEmailRequiredAction,
  currentAndNextYearRange,
  resolveCustomerEmailActionStartAt,
  resolveCustomerEmailActionTargets,
  resolveCustomerEmailReceivedAt,
} from './customerEmailActionRules.js';
import { listCustomerEmailThreadParticipantUserIds } from './customerEmailThreadService.js';

const CUSTOMER_EMAIL_BATCH_SIZE = 100;
const UNSOLICITED_EMAIL_USER_TYPE_SLUGS = [
  'admin',
  'administrator',
  'manager',
  'assistant-manager',
  'assistant_manager',
];

const findExistingAction = (gmailMessageId: string): Promise<RequiredAction | null> =>
  RequiredAction.findOne({
    where: {
      type: 'customer_email',
      [Op.and]: [sequelizeWhere(literal(`payload->>'gmailMessageId'`), gmailMessageId)],
    },
    attributes: ['id'],
  });

export const createCustomerEmailActionForMessage = async (
  gmailMessageId: string,
  startAt = resolveCustomerEmailActionStartAt(getConfigValue('CUSTOMER_EMAIL_ACTION_START_AT')),
): Promise<boolean> => {
  if (!gmailMessageId || (await findExistingAction(gmailMessageId))) {
    return false;
  }

  const email = await fetchMessagePayload(gmailMessageId);
  if (!email?.message.id || email.message.labelIds?.includes('SENT')) {
    return false;
  }

  const receivedAt = resolveCustomerEmailReceivedAt(email.message.internalDate, email.headers.date);
  if (!receivedAt || receivedAt.getTime() < startAt.getTime()) {
    return false;
  }

  const customerEmail = extractEmailAddress(email.headers.from ?? '');
  if (!customerEmail) {
    return false;
  }

  const [rangeStart, rangeEnd] = currentAndNextYearRange();
  const bookings = await Booking.findAll({
    where: {
      experienceDate: { [Op.between]: [rangeStart, rangeEnd] },
      [Op.and]: [sequelizeWhere(fn('lower', col('guest_email')), customerEmail)],
    },
    attributes: [
      'id',
      'guestFirstName',
      'guestLastName',
      'guestEmail',
      'experienceDate',
      'experienceStartAt',
    ],
    order: [
      ['experienceDate', 'ASC'],
      ['experienceStartAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  if (bookings.length === 0) {
    return false;
  }

  const actionValues = buildCustomerEmailRequiredAction({
    gmailMessageId,
    gmailThreadId: email.message.threadId ?? null,
    customerEmail,
    subject: String(email.headers.subject ?? ''),
    snippet: email.message.snippet ?? null,
    textBody: email.textBody,
    internalDate: email.message.internalDate ?? null,
    dateHeader: email.headers.date,
    bookings: bookings.map((booking) => ({
      id: Number(booking.id),
      guestFirstName: booking.guestFirstName,
      guestLastName: booking.guestLastName,
      experienceDate: booking.experienceDate,
    })),
  });
  const gmailThreadId = String(email.message.threadId ?? '').trim();
  const participantUserIds = gmailThreadId
    ? await listCustomerEmailThreadParticipantUserIds(gmailThreadId)
    : [];
  let operationsUserTypeIds: number[] = [];

  if (participantUserIds.length === 0) {
    const userTypes = await UserType.findAll({
      where: {
        slug: { [Op.in]: UNSOLICITED_EMAIL_USER_TYPE_SLUGS },
        status: true,
      },
      attributes: ['id'],
    });
    operationsUserTypeIds = Array.from(
      new Set(
        userTypes
          .map((userType) => Number(userType.id))
          .filter((userTypeId) => Number.isInteger(userTypeId) && userTypeId > 0),
      ),
    );
  }
  const targets = resolveCustomerEmailActionTargets(participantUserIds, operationsUserTypeIds);
  if (!targets) {
    logger.error('[customer-email-action] No configured users can receive this customer email request.');
    return false;
  }

  try {
    await RequiredAction.create({
      ...actionValues,
      payload: {
        ...actionValues.payload,
        routingMode: targets.routingMode,
        participantUserIds,
      },
      targetUserIds: targets.targetUserIds,
      targetUserTypeIds: targets.targetUserTypeIds,
    } as any);
    return true;
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      return false;
    }
    throw error;
  }
};

export const ingestCustomerEmailActions = async (): Promise<number> => {
  let created = 0;
  try {
    const startAt = resolveCustomerEmailActionStartAt(getConfigValue('CUSTOMER_EMAIL_ACTION_START_AT'));
    const { messages } = await listMessages({
      query: buildCustomerEmailGmailQuery(startAt),
      maxResults: CUSTOMER_EMAIL_BATCH_SIZE,
    });
    for (const message of messages) {
      if (!message.id) {
        continue;
      }
      try {
        if (await createCustomerEmailActionForMessage(message.id, startAt)) {
          created += 1;
        }
      } catch (error) {
        logger.warn(
          `[customer-email-action] Failed to inspect Gmail message ${message.id}: ${(error as Error).message}`,
        );
      }
    }
    if (created > 0) {
      logger.info(`[customer-email-action] Created ${created} customer email request(s).`);
    }
  } catch (error) {
    logger.error(`[customer-email-action] Gmail polling failed: ${(error as Error).message}`);
  }
  return created;
};
