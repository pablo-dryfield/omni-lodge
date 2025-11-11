import type { QueryInterface } from "sequelize";
import { DataTypes } from "sequelize";

type MigrationParams = { context: QueryInterface };

const TABLE_REVIEW_PLATFORMS = "review_platforms";

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_REVIEW_PLATFORMS, "weight", {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 1,
  });

  await qi.addColumn(TABLE_REVIEW_PLATFORMS, "source_key", {
    type: DataTypes.STRING(160),
    allowNull: true,
  });

  await qi.addColumn(TABLE_REVIEW_PLATFORMS, "platform_url", {
    type: DataTypes.STRING(512),
    allowNull: true,
  });

  await qi.addColumn(TABLE_REVIEW_PLATFORMS, "aliases", {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_REVIEW_PLATFORMS, "aliases");
  await qi.removeColumn(TABLE_REVIEW_PLATFORMS, "platform_url");
  await qi.removeColumn(TABLE_REVIEW_PLATFORMS, "source_key");
  await qi.removeColumn(TABLE_REVIEW_PLATFORMS, "weight");
}
