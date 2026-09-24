import type { Transaction } from 'sequelize';
import sequelize from '../config/database.js';

export const exchangeShiftAssignmentOwners = async (
  fromAssignment: { id: number; userId: number },
  toAssignment: { id: number; userId: number },
  transaction: Transaction,
): Promise<void> => {
  await sequelize.query(
    `
      UPDATE "shift_assignments"
      SET "user_id" = CASE
        WHEN "id" = :fromAssignmentId THEN :toUserId
        WHEN "id" = :toAssignmentId THEN :fromUserId
        ELSE "user_id"
      END,
      "updatedAt" = NOW()
      WHERE "id" IN (:fromAssignmentId, :toAssignmentId)
    `,
    {
      replacements: {
        fromAssignmentId: fromAssignment.id,
        toAssignmentId: toAssignment.id,
        fromUserId: fromAssignment.userId,
        toUserId: toAssignment.userId,
      },
      transaction,
    },
  );
};
