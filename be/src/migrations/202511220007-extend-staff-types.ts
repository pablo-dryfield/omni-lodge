import type { QueryInterface } from "sequelize";

type MigrationParams = { context: QueryInterface };

const STAFF_TYPE_ENUM = "enum_staff_profiles_staff_type";
const NEW_VALUES = ["assistant_manager", "manager", "guide"];

export async function up({ context }: MigrationParams): Promise<void> {
  for (const value of NEW_VALUES) {
    await context.sequelize
      .query(`ALTER TYPE "${STAFF_TYPE_ENUM}" ADD VALUE IF NOT EXISTS '${value}';`)
      .catch((error) => {
        // Ignore duplicate value errors in case another migration added it concurrently.
        if (!String(error?.message ?? "").includes("already exists")) {
          throw error;
        }
      });
  }
}

export async function down(): Promise<void> {
  // PostgreSQL does not support removing individual values from an ENUM.
  // Leaving the additional staff types in place keeps existing data valid.
}
