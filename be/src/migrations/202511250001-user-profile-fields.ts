import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'users';

const PROFILE_COLUMNS = [
  { name: 'phone', type: DataTypes.STRING },
  { name: 'country_of_citizenship', type: DataTypes.STRING },
  { name: 'date_of_birth', type: DataTypes.DATEONLY },
  { name: 'preferred_pronouns', type: DataTypes.STRING },
  { name: 'emergency_contact_name', type: DataTypes.STRING },
  { name: 'emergency_contact_relationship', type: DataTypes.STRING },
  { name: 'emergency_contact_phone', type: DataTypes.STRING },
  { name: 'emergency_contact_email', type: DataTypes.STRING },
  { name: 'arrival_date', type: DataTypes.DATEONLY },
  { name: 'departure_date', type: DataTypes.DATEONLY },
  { name: 'dietary_restrictions', type: DataTypes.TEXT },
  { name: 'allergies', type: DataTypes.TEXT },
  { name: 'medical_notes', type: DataTypes.TEXT },
  { name: 'whatsapp_handle', type: DataTypes.STRING },
  { name: 'facebook_profile_url', type: DataTypes.STRING },
  { name: 'instagram_profile_url', type: DataTypes.STRING },
  { name: 'discovery_source', type: DataTypes.STRING },
  { name: 'profile_photo_path', type: DataTypes.STRING },
  { name: 'profile_photo_url', type: DataTypes.STRING },
] as const;

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    const existingColumns = (await (context as any).describeTable(TABLE, { transaction })) as Record<string, unknown>;

    for (const column of PROFILE_COLUMNS) {
      if (column.name in existingColumns) continue;

      await context.addColumn(TABLE, column.name, {
        type: column.type,
        allowNull: true,
      }, { transaction });
    }
  });
}

export async function down(): Promise<void> {
  // These columns historically existed in production before migrations owned
  // them. Their origin cannot be distinguished safely, so rollback preserves
  // any profile data rather than destructively removing the columns.
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: { missingColumns: string[] } }> {
  const existingColumns = (await context.describeTable(TABLE)) as Record<string, unknown>;
  const missingColumns = PROFILE_COLUMNS
    .map((column) => column.name)
    .filter((columnName) => !(columnName in existingColumns));

  return {
    ok: missingColumns.length === 0,
    details: { missingColumns },
  };
}
