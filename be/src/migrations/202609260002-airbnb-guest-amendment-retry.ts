import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `UPDATE booking_emails
     SET ingestion_status = 'pending', failure_reason = NULL, "updatedAt" = NOW()
     WHERE ingestion_status = 'ignored'
       AND from_address ILIKE '%airbnb.com%'
       AND headers->>'x-template' = 'EXPERIENCES_ALTERATION_GUESTS_ALTERED_TO_HOST'`,
  );
}

export async function down(): Promise<void> {
  // Replaying the previously ignored alteration is a one-way data repair.
}
