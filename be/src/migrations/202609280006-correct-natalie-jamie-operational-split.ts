import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const KEY = 'natalie-jamie-2026-09-24-27-manager-only';

const run = async (context: QueryInterface, direction: 'up' | 'down'): Promise<void> => {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(direction === 'up'
      ? `DO $correct$
         DECLARE request_row swap_requests%ROWTYPE;
         BEGIN
           SELECT * INTO request_row FROM swap_requests
           WHERE assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${KEY}'
           LIMIT 1 FOR UPDATE;
           IF request_row.id IS NULL THEN RETURN; END IF;

           -- The schedule remains exactly as worked: Natalie managed and owned
           -- tasks Thursday; Jamie managed and owned tasks Sunday.
           UPDATE shift_assignments SET user_id = request_row.requester_id, "updatedAt" = NOW()
           WHERE id = request_row.from_assignment_id;
           UPDATE shift_assignments SET user_id = request_row.partner_id, "updatedAt" = NOW()
           WHERE id = request_row.to_assignment_id;

           UPDATE swap_requests
           SET assignment_snapshot = jsonb_set(
             jsonb_set(assignment_snapshot, '{roleBundle,salaryPolicy}', '"operational_split"'::jsonb, TRUE),
             '{roleBundle,salarySplitRecipients}',
             jsonb_build_array(
               jsonb_build_object(
                 'date', '2026-09-24',
                 'salaryRecipientUserId', request_row.requester_id,
                 'shareRecipientUserId', request_row.partner_id,
                 'shareRecipientName', assignment_snapshot->'toAssignment'->'assignee'->>'firstName'
                   || ' ' || assignment_snapshot->'toAssignment'->'assignee'->>'lastName'
               ),
               jsonb_build_object(
                 'date', '2026-09-27',
                 'salaryRecipientUserId', request_row.partner_id,
                 'shareRecipientUserId', request_row.requester_id,
                 'shareRecipientName', assignment_snapshot->'assignee'->>'firstName'
                   || ' ' || assignment_snapshot->'assignee'->>'lastName'
               )
             ), TRUE
           ), "updatedAt" = NOW()
           WHERE id = request_row.id;
         END $correct$;`
      : `DO $correct$
         DECLARE request_row swap_requests%ROWTYPE;
         BEGIN
           SELECT * INTO request_row FROM swap_requests
           WHERE assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${KEY}'
           LIMIT 1 FOR UPDATE;
           IF request_row.id IS NULL THEN RETURN; END IF;
           UPDATE shift_assignments SET user_id = request_row.partner_id, "updatedAt" = NOW()
           WHERE id = request_row.from_assignment_id;
           UPDATE shift_assignments SET user_id = request_row.requester_id, "updatedAt" = NOW()
           WHERE id = request_row.to_assignment_id;
           UPDATE swap_requests SET assignment_snapshot = jsonb_set(
             assignment_snapshot #- '{roleBundle,salarySplitRecipients}',
             '{roleBundle,salaryPolicy}', '"takeover_split"'::jsonb, TRUE
           ), "updatedAt" = NOW() WHERE id = request_row.id;
         END $correct$;`, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const up = async ({ context }: MigrationParams): Promise<void> => run(context, 'up');
export const down = async ({ context }: MigrationParams): Promise<void> => run(context, 'down');
