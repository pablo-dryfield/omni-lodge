import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const RECONCILIATION_KEY = 'natalie-jamie-2026-09-24-27-manager-only';

const run = async (context: QueryInterface, direction: 'up' | 'down'): Promise<void> => {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      direction === 'up'
        ? `DO $reconcile$
           DECLARE
             request_row swap_requests%ROWTYPE;
             thursday_assignment shift_assignments%ROWTYPE;
             sunday_assignment shift_assignments%ROWTYPE;
             original_from jsonb;
             original_to jsonb;
           BEGIN
             SELECT * INTO request_row
             FROM swap_requests
             WHERE request_type = 'swap'
               AND status = 'approved'
               AND assignment_snapshot->'shiftInstance'->>'date' = '2026-09-24'
               AND assignment_snapshot->'toAssignment'->'shiftInstance'->>'date' = '2026-09-27'
               AND LOWER(assignment_snapshot->>'roleInShift') = 'manager'
               AND LOWER(assignment_snapshot->'toAssignment'->>'roleInShift') = 'manager'
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE;

             -- Fresh databases do not contain this production-only historical
             -- request. Keep the migration portable while still validating the
             -- assignment state when the target request does exist.
             IF request_row.id IS NULL THEN
               RETURN;
             END IF;
             IF request_row.assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${RECONCILIATION_KEY}' THEN
               RETURN;
             END IF;

             SELECT sa.* INTO thursday_assignment
             FROM shift_assignments sa
             JOIN shift_instances si ON si.id = sa.shift_instance_id
             WHERE si.date = DATE '2026-09-24'
               AND LOWER(sa.role_in_shift) = 'manager'
               AND sa.user_id = request_row.requester_id
             FOR UPDATE OF sa;

             SELECT sa.* INTO sunday_assignment
             FROM shift_assignments sa
             JOIN shift_instances si ON si.id = sa.shift_instance_id
             WHERE si.date = DATE '2026-09-27'
               AND LOWER(sa.role_in_shift) = 'manager'
               AND sa.user_id = request_row.partner_id
             FOR UPDATE OF sa;

             IF thursday_assignment.id IS NULL OR sunday_assignment.id IS NULL THEN
               RAISE EXCEPTION 'Current Natalie/Jamie manager assignments do not match the approved historical swap';
             END IF;

             original_from := jsonb_set(
               request_row.assignment_snapshot - 'toAssignment' - 'roleBundle',
               '{id}', to_jsonb(thursday_assignment.id), TRUE
             );
             original_to := jsonb_set(
               request_row.assignment_snapshot->'toAssignment',
               '{id}', to_jsonb(sunday_assignment.id), TRUE
             );

             UPDATE shift_assignments
             SET user_id = request_row.partner_id, "updatedAt" = NOW()
             WHERE id = thursday_assignment.id;

             UPDATE shift_assignments
             SET user_id = request_row.requester_id, "updatedAt" = NOW()
             WHERE id = sunday_assignment.id;

             UPDATE swap_requests
             SET from_assignment_id = thursday_assignment.id,
                 to_assignment_id = sunday_assignment.id,
                 assignment_snapshot = jsonb_set(
                   request_row.assignment_snapshot,
                   '{roleBundle}',
                   jsonb_build_object(
                     'version', 1,
                     'roles', jsonb_build_array('manager'),
                     'taskPolicy', 'retain_original_owner',
                     'salaryPolicy', 'takeover_split',
                     'reconciliationKey', '${RECONCILIATION_KEY}',
                     'transfers', jsonb_build_array(jsonb_build_object(
                       'role', 'manager',
                       'fromAssignment', original_from,
                       'toAssignment', original_to
                     ))
                   ),
                   TRUE
                 ),
                 "updatedAt" = NOW()
             WHERE id = request_row.id;
           END
           $reconcile$;`
        : `DO $reconcile$
           DECLARE
             request_row swap_requests%ROWTYPE;
           BEGIN
             SELECT * INTO request_row
             FROM swap_requests
             WHERE assignment_snapshot->'roleBundle'->>'reconciliationKey' = '${RECONCILIATION_KEY}'
             LIMIT 1
             FOR UPDATE;
             IF request_row.id IS NULL THEN
               RETURN;
             END IF;

             UPDATE shift_assignments
             SET user_id = request_row.requester_id, "updatedAt" = NOW()
             WHERE id = request_row.from_assignment_id
               AND user_id = request_row.partner_id;
             UPDATE shift_assignments
             SET user_id = request_row.partner_id, "updatedAt" = NOW()
             WHERE id = request_row.to_assignment_id
               AND user_id = request_row.requester_id;
             UPDATE swap_requests
             SET from_assignment_id = NULL,
                 to_assignment_id = NULL,
                 assignment_snapshot = assignment_snapshot - 'roleBundle',
                 "updatedAt" = NOW()
             WHERE id = request_row.id;
           END
           $reconcile$;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const up = async ({ context }: MigrationParams): Promise<void> => run(context, 'up');

export const down = async ({ context }: MigrationParams): Promise<void> => run(context, 'down');
