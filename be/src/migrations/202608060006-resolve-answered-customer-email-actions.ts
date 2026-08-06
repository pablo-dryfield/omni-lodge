import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  // Repair active email requests that were already answered through the
  // manifest mailbox before threaded sends automatically resolved them.
  await context.sequelize.query(`
    WITH answered AS (
      SELECT DISTINCT ON (action.id)
        action.id AS action_id,
        participant.user_id,
        participant.last_sent_at,
        participant.last_message_id,
        participant.thread_id
      FROM required_actions AS action
      JOIN customer_email_thread_participants AS participant
        ON participant.thread_id = action.payload->>'gmailThreadId'
      WHERE action.type = 'customer_email'
        AND action.status = TRUE
        AND participant.last_sent_at >= action.created_at
      ORDER BY action.id, participant.last_sent_at DESC
    ),
    resolved AS (
      UPDATE required_actions AS action
      SET status = FALSE,
          updated_by = answered.user_id,
          updated_at = answered.last_sent_at,
          payload = action.payload || jsonb_build_object(
            'resolvedAt', answered.last_sent_at,
            'resolvedByUserId', answered.user_id,
            'resolution', 'replied',
            'replyMessageId', answered.last_message_id
          )
      FROM answered
      WHERE action.id = answered.action_id
      RETURNING action.id
    )
    INSERT INTO required_action_completions (
      required_action_id,
      user_id,
      status,
      completed_at,
      response_json,
      created_at,
      updated_at
    )
    SELECT
      answered.action_id,
      answered.user_id,
      'completed',
      answered.last_sent_at,
      jsonb_build_object(
        'selectedAction', 'replied',
        'repliedAt', answered.last_sent_at,
        'sentMessageId', answered.last_message_id,
        'gmailThreadId', answered.thread_id,
        'reconciledByMigration', TRUE
      ),
      NOW(),
      NOW()
    FROM answered
    JOIN resolved ON resolved.id = answered.action_id
    ON CONFLICT (required_action_id, user_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      completed_at = EXCLUDED.completed_at,
      response_json = EXCLUDED.response_json,
      updated_at = NOW();
  `);
}

export async function down(): Promise<void> {
  // Intentionally irreversible: reopening answered emails would recreate
  // incorrect pending-reply indicators.
}
