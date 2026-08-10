import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TEMPLATE_NAME = 'T-Shirt Size Selection';
const TEMPLATE_DESCRIPTION =
  'Automatic customer request for T-shirt sizes. Available variants come from live inventory; customers reply with their preferred sizes.';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `UPDATE email_templates
     SET is_active = false, updated_at = NOW()
     WHERE lower(name) = lower(:name)
       AND description = :description
       AND created_by IS NULL
       AND updated_by IS NULL
       AND updated_at = created_at;`,
    { replacements: { name: TEMPLATE_NAME, description: TEMPLATE_DESCRIPTION } },
  );
}

export async function down(): Promise<void> {
  // Intentionally empty: customer-facing templates must never be activated automatically.
}
