import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const CONTENT_TABLE = 'social_media_contents';
const ASSET_TABLE = 'social_media_content_assets';

const addContentWorkflowColumns = async (
  context: QueryInterface,
  transaction: Transaction,
): Promise<void> => {
  await context.addColumn(
    CONTENT_TABLE,
    'drive_project_folder_id',
    { type: DataTypes.STRING(255), allowNull: true },
    { transaction },
  );
  await context.addColumn(
    CONTENT_TABLE,
    'production_started_at',
    { type: DataTypes.DATE, allowNull: true },
    { transaction },
  );
  await context.addColumn(
    CONTENT_TABLE,
    'ready_at',
    { type: DataTypes.DATE, allowNull: true },
    { transaction },
  );
  await context.addColumn(
    CONTENT_TABLE,
    'published_by',
    {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    { transaction },
  );
  await context.addColumn(
    CONTENT_TABLE,
    'published_task_log_id',
    {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'am_task_logs', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    { transaction },
  );
};

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    // Preserve the date users saw in Warsaw while removing the artificial hour.
    await context.sequelize.query(
      `ALTER TABLE ${CONTENT_TABLE}
         ALTER COLUMN scheduled_at TYPE DATE
         USING CASE
           WHEN scheduled_at IS NULL THEN NULL
           ELSE (scheduled_at AT TIME ZONE 'Europe/Warsaw')::date
         END;`,
      { transaction },
    );
    await context.sequelize.query(
      `ALTER TABLE ${CONTENT_TABLE}
         ALTER COLUMN target_platforms
         SET DEFAULT '["instagram", "tiktok"]'::jsonb;`,
      { transaction },
    );
    await context.sequelize.query(
      `UPDATE ${CONTENT_TABLE}
          SET target_platforms = '["instagram", "tiktok"]'::jsonb,
              updated_at = NOW()
        WHERE target_platforms = '[]'::jsonb;`,
      { transaction },
    );

    await addContentWorkflowColumns(context, transaction);

    await context.createTable(
      ASSET_TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        content_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: CONTENT_TABLE, key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        kind: { type: DataTypes.STRING(32), allowNull: false },
        original_name: { type: DataTypes.STRING(255), allowNull: false },
        mime_type: { type: DataTypes.STRING(255), allowNull: false },
        size_bytes: { type: DataTypes.BIGINT, allowNull: false },
        drive_file_id: { type: DataTypes.STRING(255), allowNull: false },
        web_view_url: { type: DataTypes.TEXT, allowNull: false },
        uploaded_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      },
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${ASSET_TABLE}
         ADD CONSTRAINT social_media_content_assets_kind_ck
         CHECK (kind IN ('final_video', 'raw_material', 'project_file')),
         ADD CONSTRAINT social_media_content_assets_original_name_ck
         CHECK (length(btrim(original_name)) > 0),
         ADD CONSTRAINT social_media_content_assets_mime_type_ck
         CHECK (length(btrim(mime_type)) > 0),
         ADD CONSTRAINT social_media_content_assets_size_ck
         CHECK (size_bytes > 0),
         ADD CONSTRAINT social_media_content_assets_drive_file_id_ck
         CHECK (length(btrim(drive_file_id)) > 0),
         ADD CONSTRAINT social_media_content_assets_web_view_url_ck
         CHECK (length(btrim(web_view_url)) > 0);`,
      { transaction },
    );

    await context.addIndex(CONTENT_TABLE, ['drive_project_folder_id'], {
      name: 'social_media_contents_drive_project_folder_id_uq',
      unique: true,
      transaction,
    });
    await context.addIndex(CONTENT_TABLE, ['published_task_log_id'], {
      name: 'social_media_contents_published_task_log_id_uq',
      unique: true,
      transaction,
    });
    await context.addIndex(ASSET_TABLE, ['content_id', 'kind'], {
      name: 'social_media_content_assets_content_kind_idx',
      transaction,
    });
    await context.addIndex(ASSET_TABLE, ['content_id'], {
      name: 'social_media_content_assets_one_final_video_uq',
      unique: true,
      where: { kind: 'final_video' },
      transaction,
    });
    await context.addIndex(ASSET_TABLE, ['drive_file_id'], {
      name: 'social_media_content_assets_drive_file_id_uq',
      unique: true,
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.dropTable(ASSET_TABLE, { transaction });
    await context.removeIndex(CONTENT_TABLE, 'social_media_contents_published_task_log_id_uq', {
      transaction,
    });
    await context.removeIndex(CONTENT_TABLE, 'social_media_contents_drive_project_folder_id_uq', {
      transaction,
    });
    await context.removeColumn(CONTENT_TABLE, 'published_task_log_id', { transaction });
    await context.removeColumn(CONTENT_TABLE, 'published_by', { transaction });
    await context.removeColumn(CONTENT_TABLE, 'ready_at', { transaction });
    await context.removeColumn(CONTENT_TABLE, 'production_started_at', { transaction });
    await context.removeColumn(CONTENT_TABLE, 'drive_project_folder_id', { transaction });

    await context.sequelize.query(
      `ALTER TABLE ${CONTENT_TABLE}
         ALTER COLUMN scheduled_at TYPE TIMESTAMPTZ
         USING CASE
           WHEN scheduled_at IS NULL THEN NULL
           ELSE scheduled_at::timestamp AT TIME ZONE 'Europe/Warsaw'
         END;`,
      { transaction },
    );
    await context.sequelize.query(
      `ALTER TABLE ${CONTENT_TABLE}
         ALTER COLUMN target_platforms SET DEFAULT '[]'::jsonb;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const contentTable = await context.describeTable(CONTENT_TABLE);
  const [rows] = await context.sequelize.query(
    `SELECT
       to_regclass(:assetTable) IS NOT NULL AS asset_table_exists,
       to_regclass(:finalVideoIndex) IS NOT NULL AS final_video_unique_index_exists,
       (
         SELECT data_type = 'date'
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = :contentTable
            AND column_name = 'scheduled_at'
       ) AS scheduled_at_is_date;`,
    {
      replacements: {
        assetTable: ASSET_TABLE,
        contentTable: CONTENT_TABLE,
        finalVideoIndex: 'social_media_content_assets_one_final_video_uq',
      },
    },
  );
  const state = (rows as Array<{
    asset_table_exists: boolean;
    final_video_unique_index_exists: boolean;
    scheduled_at_is_date: boolean;
  }>)[0];
  const requiredColumns = [
    'drive_project_folder_id',
    'production_started_at',
    'ready_at',
    'published_by',
    'published_task_log_id',
  ];
  const missingColumns = requiredColumns.filter((column) => !contentTable[column]);

  return {
    ok:
      missingColumns.length === 0 &&
      Boolean(state?.asset_table_exists) &&
      Boolean(state?.final_video_unique_index_exists) &&
      Boolean(state?.scheduled_at_is_date),
    details: { missingColumns, ...state },
  };
}
