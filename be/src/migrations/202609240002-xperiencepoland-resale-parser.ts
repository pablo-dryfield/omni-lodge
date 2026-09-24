import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `UPDATE booking_emails
     SET ingestion_status = 'pending', failure_reason = NULL, "updatedAt" = NOW()
     WHERE ingestion_status = 'ignored'
       AND from_address ILIKE '%noreply@pubcrawlkrakow.pl%'
       AND subject ILIKE 'New Booking:%'
       AND snippet ILIKE '%New Resale Booking%'
       AND snippet ILIKE '%Reference%'`,
  );
}

export async function down(): Promise<void> {
  // The previous parser missed legitimate resale bookings. Do not restore ignored status.
}
