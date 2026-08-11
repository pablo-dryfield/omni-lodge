import { col, fn, literal, Op, UniqueConstraintError, where as sequelizeWhere } from 'sequelize';
import Booking from '../../models/Booking.js';
import RequiredAction from '../../models/RequiredAction.js';
import RequiredActionCompletion from '../../models/RequiredActionCompletion.js';
import CustomerEmailInspection from '../../models/CustomerEmailInspection.js';
import UserType from '../../models/UserType.js';
import { getConfigValue } from '../configService.js';
import logger from '../../utils/logger.js';
import {
  extractEmailAddress,
  fetchMessagePayload,
  isGmailCooldownError,
  isGmailRateLimitError,
  listMessages,
} from './gmailClient.js';
import {
  buildCustomerEmailGmailQuery,
  buildCustomerEmailRequiredAction,
  currentAndNextYearRange,
  resolveCustomerEmailActionStartAt,
  resolveCustomerEmailActionTargets,
  resolveCustomerEmailReceivedAt,
} from './customerEmailActionRules.js';
import { listCustomerEmailThreadParticipantUserIds } from './customerEmailThreadService.js';

const CUSTOMER_EMAIL_LIST_SIZE = 100;
const DEFAULT_CUSTOMER_EMAIL_INSPECTION_BATCH_SIZE = 10;
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

const resolveInspectionBatchSize = (): number => {
  const configured = Number(getConfigValue('CUSTOMER_EMAIL_ACTION_BATCH_SIZE'));
  if (!Number.isInteger(configured)) return DEFAULT_CUSTOMER_EMAIL_INSPECTION_BATCH_SIZE;
  return Math.min(25, Math.max(1, configured));
};

export const resolveCustomerEmailActionsForReply = async ({
  gmailThreadId,
  replyToMessageId,
  sentMessageId,
  actorId,
  repliedAt = new Date(),
}: {
  gmailThreadId: string;
  replyToMessageId?: string | null;
  sentMessageId?: string | null;
  actorId: number;
  repliedAt?: Date;
}): Promise<number[]> => {
  const threadId = gmailThreadId.trim();
  const repliedToId = String(replyToMessageId ?? '').trim();
  if (!threadId || !Number.isInteger(actorId) || actorId <= 0) {
    return [];
  }

  const matchingActions = await RequiredAction.findAll({
    where: {
      type: 'customer_email',
      status: true,
      [Op.or]: [
        sequelizeWhere(literal(`payload->>'gmailThreadId'`), threadId),
        ...(repliedToId
          ? [sequelizeWhere(literal(`payload->>'gmailMessageId'`), repliedToId)]
          : []),
      ],
    },
    order: [['id', 'ASC']],
  });

  const replyTimestamp = repliedAt.getTime();
  const actionsToResolve = matchingActions.filter((action) => {
    const gmailMessageId = String(action.payload?.gmailMessageId ?? '').trim();
    if (repliedToId && gmailMessageId === repliedToId) {
      return true;
    }
    const receivedTimestamp = new Date(String(action.payload?.receivedAt ?? '')).getTime();
    return Number.isFinite(receivedTimestamp) && receivedTimestamp <= replyTimestamp;
  });

  const responseJson = {
    selectedAction: 'replied',
    repliedAt: repliedAt.toISOString(),
    replyToMessageId: repliedToId || null,
    sentMessageId: sentMessageId ?? null,
    gmailThreadId: threadId,
  };

  await Promise.all(
    actionsToResolve.map(async (action) => {
      await action.update({
        status: false,
        updatedBy: actorId,
        payload: {
          ...action.payload,
          resolvedAt: repliedAt.toISOString(),
          resolvedByUserId: actorId,
          resolution: 'replied',
          replyMessageId: sentMessageId ?? null,
        },
      });

      const existingCompletion = await RequiredActionCompletion.findOne({
        where: { requiredActionId: action.id, userId: actorId },
      });
      if (existingCompletion) {
        await existingCompletion.update({
          status: 'completed',
          completedAt: repliedAt,
          responseJson,
        });
      } else {
        await RequiredActionCompletion.create({
          requiredActionId: action.id,
          userId: actorId,
          status: 'completed',
          completedAt: repliedAt,
          responseJson,
        });
      }
    }),
  );

  return actionsToResolve.map((action) => Number(action.id));
};

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
      maxResults: CUSTOMER_EMAIL_LIST_SIZE,
    });
    const messageIds = messages
      .map((message) => String(message.id ?? '').trim())
      .filter(Boolean);
    await CustomerEmailInspection.destroy({
      where: {
        status: 'processing',
        updatedAt: { [Op.lt]: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    const completedInspections = await CustomerEmailInspection.findAll({
      where: {
        gmailMessageId: { [Op.in]: messageIds },
        status: 'completed',
      },
      attributes: ['gmailMessageId'],
    });
    const completedIds = new Set(completedInspections.map((entry) => entry.gmailMessageId));
    const candidates = messages
      .filter((message) => Boolean(message.id) && !completedIds.has(String(message.id)))
      .slice(0, resolveInspectionBatchSize());

    for (const message of candidates) {
      const gmailMessageId = String(message.id);
      const [inspection, claimed] = await CustomerEmailInspection.findOrCreate({
        where: { gmailMessageId },
        defaults: {
          gmailMessageId,
          status: 'processing',
          actionCreated: false,
          inspectedAt: null,
        },
      });
      if (!claimed) continue;

      try {
        const actionCreated = await createCustomerEmailActionForMessage(gmailMessageId, startAt);
        if (actionCreated) {
          created += 1;
        }
        await inspection.update({
          status: 'completed',
          actionCreated,
          inspectedAt: new Date(),
        });
      } catch (error) {
        await inspection.destroy().catch(() => undefined);
        if (isGmailRateLimitError(error)) {
          throw error;
        }
        logger.warn(
          `[customer-email-action] Failed to inspect Gmail message ${gmailMessageId}: ${(error as Error).message}`,
        );
      }
    }
    if (created > 0) {
      logger.info(`[customer-email-action] Created ${created} customer email request(s).`);
    }
  } catch (error) {
    if (isGmailCooldownError(error)) {
      logger.debug(`[customer-email-action] Gmail polling skipped: ${(error as Error).message}`);
    } else {
      logger.error(`[customer-email-action] Gmail polling failed: ${(error as Error).message}`);
    }
  }
  return created;
};
