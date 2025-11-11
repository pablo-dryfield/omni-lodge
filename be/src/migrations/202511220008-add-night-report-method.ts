import type { QueryInterface } from "sequelize";

type MigrationParams = { context: QueryInterface };

const CALCULATION_METHOD_ENUM = "enum_compensation_components_calculation_method";

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize
    .query(`ALTER TYPE "${CALCULATION_METHOD_ENUM}" ADD VALUE IF NOT EXISTS 'night_report';`)
    .catch((error) => {
      if (!String(error?.message ?? "").includes("already exists")) {
        throw error;
      }
    });
}

export async function down(): Promise<void> {
  // No safe way to drop individual ENUM values in PostgreSQL without recreating the type.
}
