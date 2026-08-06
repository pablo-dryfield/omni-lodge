import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  // Earlier code globally closed a customer-email request when any recipient
  // clicked Complete. Reopen those requests so users without a completion can
  // still see them; per-user completion filtering keeps them hidden for users
  // who already completed them. A real Reply remains globally resolved.
  await context.sequelize.query(`
    UPDATE required_actions AS action
    SET status = TRUE,
        updated_at = NOW()
    WHERE action.type = 'customer_email'
      AND action.status = FALSE
      AND action.created_at >= TIMESTAMPTZ '2026-08-05 22:00:00+00'
      AND EXISTS (
        SELECT 1
        FROM required_action_completions AS completion
        WHERE completion.required_action_id = action.id
          AND completion.status = 'completed'
          AND completion.response_json->>'selectedAction' = 'completed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM required_action_completions AS completion
        WHERE completion.required_action_id = action.id
          AND completion.status = 'completed'
          AND completion.response_json->>'selectedAction' = 'replied'
      );
  `);
}

export async function down(): Promise<void> {
  // Intentionally irreversible: closing these actions again would hide unread
  // customer emails from their remaining recipients.
}
