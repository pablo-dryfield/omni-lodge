import { UniqueConstraintError } from 'sequelize';
import CustomerEmailThreadParticipant from '../../models/CustomerEmailThreadParticipant.js';

export const recordCustomerEmailThreadParticipant = async ({
  threadId,
  userId,
  messageId,
}: {
  threadId: string;
  userId: number;
  messageId?: string | null;
}): Promise<void> => {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || !Number.isInteger(userId) || userId <= 0) {
    return;
  }

  const now = new Date();
  const existing = await CustomerEmailThreadParticipant.findOne({
    where: { threadId: normalizedThreadId, userId },
  });
  if (existing) {
    await existing.update({
      lastMessageId: messageId ?? existing.lastMessageId,
      lastSentAt: now,
    });
    return;
  }

  try {
    await CustomerEmailThreadParticipant.create({
      threadId: normalizedThreadId,
      userId,
      firstMessageId: messageId ?? null,
      lastMessageId: messageId ?? null,
      firstSentAt: now,
      lastSentAt: now,
    } as any);
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) {
      throw error;
    }
    await CustomerEmailThreadParticipant.update(
      { lastMessageId: messageId ?? null, lastSentAt: now },
      { where: { threadId: normalizedThreadId, userId } },
    );
  }
};

export const listCustomerEmailThreadParticipantUserIds = async (threadId: string): Promise<number[]> => {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return [];
  }
  const rows = await CustomerEmailThreadParticipant.findAll({
    where: { threadId: normalizedThreadId },
    attributes: ['userId'],
    order: [['id', 'ASC']],
  });
  return Array.from(
    new Set(rows.map((row) => Number(row.userId)).filter((userId) => Number.isInteger(userId) && userId > 0)),
  );
};
