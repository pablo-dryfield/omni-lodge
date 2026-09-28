import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const KEY = 'natalie-jamie-2026-09-24-27-manager-only';

const run = async (context: QueryInterface, direction: 'up' | 'down'): Promise<void> => {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    const assignmentOwners = direction === 'up'
      ? ['requester_id', 'partner_id'] as const
      : ['partner_id', 'requester_id'] as const;

    // Keep this as ordinary SQL rather than an anonymous PL/pgSQL block so the
    // deployment runner can execute and diagnose each statement directly.
    // These statements are still atomic because they share the surrounding
    // transaction, and remain a no-op without the historical request.
    await context.sequelize.query(
      `WITH target AS (
         SELECT requester_id, partner_id, from_assignment_id, to_assignment_id
         FROM swap_requests
         WHERE assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${KEY}'
         ORDER BY id DESC
         LIMIT 1
       )
       UPDATE shift_assignments AS assignment
       SET user_id = CASE
             WHEN assignment.id = target.from_assignment_id THEN target.${assignmentOwners[0]}
             WHEN assignment.id = target.to_assignment_id THEN target.${assignmentOwners[1]}
             ELSE assignment.user_id
           END,
           "updatedAt" = NOW()
       FROM target
       WHERE assignment.id IN (target.from_assignment_id, target.to_assignment_id);`,
      { transaction },
    );

    await context.sequelize.query(direction === 'up'
      ? `UPDATE swap_requests
           SET assignment_snapshot = jsonb_set(
             jsonb_set(assignment_snapshot, '{roleBundle,salaryPolicy}', '"operational_split"'::jsonb, TRUE),
             '{roleBundle,salarySplitRecipients}',
             jsonb_build_array(
               jsonb_build_object(
                 'date', '2026-09-24',
                 'salaryRecipientUserId', requester_id,
                 'shareRecipientUserId', partner_id,
                 'shareRecipientName', concat_ws(' ',
                   assignment_snapshot->'toAssignment'->'assignee'->>'firstName',
                   assignment_snapshot->'toAssignment'->'assignee'->>'lastName'
                 )
               ),
               jsonb_build_object(
                 'date', '2026-09-27',
                 'salaryRecipientUserId', partner_id,
                 'shareRecipientUserId', requester_id,
                 'shareRecipientName', concat_ws(' ',
                   assignment_snapshot->'assignee'->>'firstName',
                   assignment_snapshot->'assignee'->>'lastName'
                 )
               )
             ), TRUE
           ), "updatedAt" = NOW()
           WHERE assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${KEY}';`
      : `UPDATE swap_requests SET assignment_snapshot = jsonb_set(
             assignment_snapshot #- '{roleBundle,salarySplitRecipients}',
             '{roleBundle,salaryPolicy}', '"takeover_split"'::jsonb, TRUE
           ), "updatedAt" = NOW()
           WHERE assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${KEY}';`,
      { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const up = async ({ context }: MigrationParams): Promise<void> => run(context, 'up');
export const down = async ({ context }: MigrationParams): Promise<void> => run(context, 'down');
